import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import Document from '../models/Document';
import {
    buildDocumentFilter,
    canAccessDocument,
    canDeleteDocument,
} from '../services/accessScope';
import {
    annotateDuplicateCounts,
    getDuplicateDocumentIds,
    getDuplicateGroupSizes,
} from '../services/duplicateDetection';
import {
    deleteDocumentFully,
    ensureUploadDir,
    saveUploadedFile,
    applyDocumentTypeStorage,
} from '../services/documentStorage';
import { recordActivityFromReq } from '../services/activityLog';
import {
    getAiDocument,
    getAiDocumentImages,
    getDocumentJobStatus,
    getSimilarDocuments,
    isAiServiceEnabled,
    listAiValidations,
    resolveAiOrganizationId,
    resolveDocumentAiOrgId,
    streamAiAsset,
    triggerDocumentReprocess,
    updateAiDocumentSettings,
} from '../services/aiServiceClient';
import { PERMISSIONS } from '../types/permissions';
import { hasPermission } from '../services/accessScope';
import logger from '../utils/logger';

const SORT_FIELDS: Record<string, string> = {
    createdAt: 'createdAt',
    name: 'originalFilename',
    size: 'sizeBytes',
    status: 'status',
    score: 'metadata.cvScore',
};

const PYTHON_DONE_STATUSES = ['processed', 'embedded', 'classified', 'completed', 'ready'];
const PYTHON_FAILED_STATUSES = ['failed', 'error'];

async function syncStatusFromAiDocument(
    doc: InstanceType<typeof Document>,
    orgId: string,
    user?: { organizationId?: string | null; userId: string }
): Promise<Record<string, unknown> | null> {
    if (!isAiServiceEnabled() || !doc.pythonDocumentId) return null;

    const aiOrgId = user ? resolveDocumentAiOrgId(doc, user) : orgId;
    const aiDoc = await getAiDocument(doc.pythonDocumentId, aiOrgId);
    if (!aiDoc) return null;

    const pyStatus = String(aiDoc.status || '').toLowerCase();
    if (aiDoc.status) {
        doc.aiProcessingStatus = String(aiDoc.status);
    }

    if (PYTHON_FAILED_STATUSES.some((s) => pyStatus.includes(s))) {
        doc.status = 'failed';
        if (aiDoc.error_message) {
            doc.aiErrorMessage = String(aiDoc.error_message);
        }
    } else if (PYTHON_DONE_STATUSES.some((s) => pyStatus.includes(s))) {
        doc.status = 'ready';
        if (aiDoc.page_count != null) {
            doc.pageCount = Number(aiDoc.page_count) || 0;
        }
        if (aiDoc.cv_score != null) {
            doc.metadata = { ...(doc.metadata || {}), cvScore: Number(aiDoc.cv_score) };
        }
        if (aiDoc.phase3_agent) {
            doc.metadata = {
                ...(doc.metadata || {}),
                phase3Agent: String(aiDoc.phase3_agent),
            };
        }
    } else if (pyStatus) {
        doc.status = 'processing';
    }

    // Relocate as soon as AI knows the type (filename never decides the folder)
    if (aiDoc.document_type) {
        doc.classification = String(aiDoc.document_type);
        try {
            await applyDocumentTypeStorage(doc, String(aiDoc.document_type));
        } catch (e: any) {
            logger.warn(`Storage relocate failed for ${doc.documentId}: ${e.message}`);
        }
    }

    return aiDoc;
}

export const listDocuments = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        if (req.query.withIntel === 'true') {
            return listAllDocumentIntelligence(req, res, next);
        }

        const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
        const q = ((req.query.q as string) || '').trim();
        const sortBy = SORT_FIELDS[(req.query.sortBy as string) || 'createdAt'] || 'createdAt';
        const sortOrder = (req.query.sortOrder as string) === 'asc' ? 1 : -1;
        const status = (req.query.status as string) || '';
        const mimeType = (req.query.mimeType as string) || '';
        const organizationId = (req.query.organizationId as string) || undefined;
        const duplicatesOnly = (req.query.duplicatesOnly as string) === 'true';
        const scoreFilter = ((req.query.scoreFilter as string) || '').trim();

        const extra: Record<string, unknown> = {};
        if (status) extra.status = status;
        if (mimeType) extra.mimeType = new RegExp(mimeType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (q) {
            extra.$or = [
                { originalFilename: { $regex: q, $options: 'i' } },
                { classification: { $regex: q, $options: 'i' } },
                { documentId: { $regex: q, $options: 'i' } },
            ];
        }
        if (scoreFilter === 'high') {
            extra['metadata.cvScore'] = { $gte: 70 };
        } else if (scoreFilter === 'medium') {
            extra['metadata.cvScore'] = { $gte: 40, $lt: 70 };
        } else if (scoreFilter === 'low') {
            extra['metadata.cvScore'] = { $gte: 0, $lt: 40 };
        } else if (scoreFilter === 'scored') {
            extra['metadata.cvScore'] = { $exists: true, $ne: null };
        }

        const baseFilter = buildDocumentFilter(req.user, extra, { organizationId });
        let filter = baseFilter;

        if (duplicatesOnly) {
            const duplicateIds = await getDuplicateDocumentIds(baseFilter);
            if (!duplicateIds.length) {
                return res.json({
                    success: true,
                    data: {
                        documents: [],
                        pagination: { page: 1, limit, total: 0, totalPages: 0 },
                    },
                });
            }
            filter = { ...baseFilter, documentId: { $in: duplicateIds } };
        }

        const [documents, total, duplicateSizes] = await Promise.all([
            Document.find(filter)
                .sort({ [sortBy]: sortOrder })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            Document.countDocuments(filter),
            getDuplicateGroupSizes(baseFilter),
        ]);

        res.json({
            success: true,
            data: {
                documents: annotateDuplicateCounts(documents, duplicateSizes),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit) || 0,
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        res.json({ success: true, data: { document: doc } });
    } catch (error) {
        next(error);
    }
};

export const streamDocument = (disposition: 'inline' | 'attachment') =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            // View covers both preview (inline) and download
            if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }

            const doc = await Document.findOne({ documentId: req.params.id });
            if (!doc) {
                return res.status(404).json({ success: false, message: 'Document not found' });
            }
            if (!canAccessDocument(req.user, doc)) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
            if (!fs.existsSync(doc.storagePath)) {
                return res.status(404).json({ success: false, message: 'File not found on disk' });
            }

            res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
            res.setHeader(
                'Content-Disposition',
                `${disposition}; filename="${encodeURIComponent(doc.originalFilename)}"`
            );
            recordActivityFromReq(req, {
                action: disposition === 'inline' ? 'document.preview' : 'document.download',
                category: 'document',
                resourceType: 'document',
                resourceId: doc.documentId,
                message: `${disposition === 'inline' ? 'Previewed' : 'Downloaded'} ${doc.originalFilename}`,
                metadata: { filename: doc.originalFilename },
            });
            fs.createReadStream(doc.storagePath).pipe(res);
        } catch (error) {
            next(error);
        }
    };

export const uploadDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_UPLOAD)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        ensureUploadDir();
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const phase3Agent = ((req.body?.phase3Agent as string) || '').trim() || undefined;
        const { doc, aiModelResponse } = await saveUploadedFile(req.user, file, phase3Agent);
        recordActivityFromReq(req, {
            action: 'document.upload',
            category: 'document',
            resourceType: 'document',
            resourceId: doc.documentId,
            message: `Uploaded ${doc.originalFilename}`,
            metadata: { filename: doc.originalFilename, mimeType: doc.mimeType },
        });
        res.status(201).json({
            success: true,
            message: 'Document uploaded successfully',
            data: { document: doc, aiModelResponse },
        });
    } catch (error: any) {
        if (error.statusCode === 429 || error.code === 'GROQ_RATE_LIMIT') {
            return res.status(429).json({
                success: false,
                code: 'GROQ_RATE_LIMIT',
                message: error.message || 'Groq rate limit reached',
                ...(error.groq || {}),
                console_url: error.groq?.console_url || 'https://console.groq.com/keys',
                billing_url: error.groq?.billing_url || 'https://console.groq.com/settings/billing',
                retry_after_seconds: error.groq?.retry_after_seconds || 24 * 3600,
            });
        }
        if (error.statusCode === 415) {
            return res.status(415).json({ success: false, message: error.message });
        }
        if (error.statusCode === 409) {
            return res.status(409).json({ success: false, message: error.message });
        }
        next(error);
    }
};

export const uploadDocumentsBulk = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_UPLOAD)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        ensureUploadDir();
        const files = (req.files as Express.Multer.File[]) || [];
        if (!files.length) {
            return res.status(400).json({ success: false, message: 'No files uploaded' });
        }

        const uploaded: any[] = [];
        const failed: { name: string; reason: string }[] = [];

        for (const file of files) {
            try {
                const { doc } = await saveUploadedFile(req.user, file);
                uploaded.push(doc);
            } catch (err: any) {
                if (err.statusCode === 429 || err.code === 'GROQ_RATE_LIMIT') {
                    return res.status(429).json({
                        success: false,
                        code: 'GROQ_RATE_LIMIT',
                        message: err.message || 'Groq rate limit reached',
                        ...(err.groq || {}),
                        console_url: err.groq?.console_url || 'https://console.groq.com/keys',
                        billing_url: err.groq?.billing_url || 'https://console.groq.com/settings/billing',
                        retry_after_seconds: err.groq?.retry_after_seconds || 24 * 3600,
                        data: { uploaded, failed },
                    });
                }
                failed.push({ name: file.originalname, reason: err.message || 'Upload failed' });
            }
        }

        if (uploaded.length) {
            recordActivityFromReq(req, {
                action: 'document.upload.bulk',
                category: 'document',
                message: `Uploaded ${uploaded.length} file(s)${failed.length ? `, ${failed.length} failed` : ''}`,
                metadata: {
                    uploadedCount: uploaded.length,
                    failedCount: failed.length,
                    filenames: uploaded.map((d) => d.originalFilename),
                },
            });
        }

        res.status(uploaded.length ? 201 : 400).json({
            success: uploaded.length > 0,
            message: `Uploaded ${uploaded.length} file(s)${failed.length ? `, ${failed.length} failed` : ''}`,
            data: { uploaded, failed },
        });
    } catch (error) {
        next(error);
    }
};

export const getDocumentProcessing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        let aiJob = null;
        let aiDocument = null;
        const orgId = resolveDocumentAiOrgId(doc, req.user);
        const runModel = req.query.runModel === 'true' || req.query.runModel === '1';

        if (isAiServiceEnabled() && doc.pythonDocumentId) {
            aiDocument = await syncStatusFromAiDocument(doc, orgId, req.user);
            aiJob = await getDocumentJobStatus(doc.pythonDocumentId, orgId);

            const missingData =
                !aiDocument?.cv_score &&
                !aiDocument?.extracted_data &&
                !(typeof aiDocument?.raw_text === 'string' && String(aiDocument.raw_text).length > 50);

            const jobStage = String(aiJob?.stage || '').toLowerCase();
            const jobStatus = String(aiJob?.status || '').toLowerCase();
            const activeStages = [
                'queued', 'running', 'preprocessing', 'ocr_processing', 'ocr_done',
                'classifying', 'classified', 'extracting', 'extracted', 'embedding', 'embedded', 'image_extraction',
            ];
            const alreadyRunning =
                activeStages.includes(jobStage) ||
                jobStatus === 'running' ||
                String(aiDocument?.status || '').toLowerCase() === 'processing';

            if (runModel && missingData && !alreadyRunning) {
                try {
                    doc.status = 'processing';
                    doc.aiErrorMessage = null;
                    await doc.save();
                    await triggerDocumentReprocess(doc.pythonDocumentId, orgId);
                } catch (e: any) {
                    const logger = (await import('../utils/logger')).default;
                    logger.warn(`Auto model run failed for ${doc.documentId}: ${e.message}`);
                }
            }

            await doc.save();
            aiDocument = await syncStatusFromAiDocument(doc, orgId, req.user);
            await doc.save();
            if (!aiJob) {
                aiJob = await getDocumentJobStatus(doc.pythonDocumentId, orgId);
            }
        }

        res.json({
            success: true,
            data: {
                documentId: doc.documentId,
                pythonDocumentId: doc.pythonDocumentId,
                status: doc.status,
                aiProcessingStatus: doc.aiProcessingStatus,
                aiErrorMessage: doc.aiErrorMessage,
                job: aiJob,
                aiDocument,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const updateDocumentAiSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        if (!doc.pythonDocumentId) {
            return res.status(400).json({ success: false, message: 'Document not linked to AI model' });
        }

        const { documentType, phase3Agent } = req.body || {};
        if (!documentType || !phase3Agent) {
            return res.status(400).json({ success: false, message: 'documentType and phase3Agent are required' });
        }

        const orgId = resolveAiOrganizationId(req.user);
        const result = await updateAiDocumentSettings({
            pythonDocumentId: doc.pythonDocumentId,
            organizationId: orgId,
            documentType: String(documentType),
            phase3Agent: String(phase3Agent),
        });

        doc.classification = String(documentType);
        doc.metadata = {
            ...(doc.metadata || {}),
            phase3Agent: String(phase3Agent),
        };
        try {
            await applyDocumentTypeStorage(doc, String(documentType));
        } catch (e: any) {
            logger.warn(`Storage relocate failed for ${doc.documentId}: ${e?.message || e}`);
        }
        await doc.save();

        res.json({
            success: true,
            data: { document: doc, aiUpdate: result },
        });
    } catch (error) {
        next(error);
    }
};

export const getDocumentIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const orgId = resolveDocumentAiOrgId(doc, req.user);
        let aiDocument = null;
        let job = null;
        let validations: unknown[] = [];

        if (isAiServiceEnabled() && doc.pythonDocumentId) {
            const synced = await syncStatusFromAiDocument(doc, orgId, req.user);
            await doc.save();
            aiDocument = synced;
            [job, validations] = await Promise.all([
                getDocumentJobStatus(doc.pythonDocumentId, orgId),
                doc.status === 'ready'
                    ? listAiValidations(orgId, doc.pythonDocumentId)
                    : Promise.resolve([]),
            ]);
        }

        res.json({
            success: true,
            data: {
                document: doc,
                aiDocument,
                job,
                validations,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const listAllDocumentIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const filter = buildDocumentFilter(req.user, {});
        const docs = await Document.find(filter).sort({ createdAt: -1 }).limit(100);

        const documents = await Promise.all(
            docs.map(async (doc) => {
                let aiDocument = null;
                let job = null;
                let validations: unknown[] = [];
                const orgId = resolveDocumentAiOrgId(doc, req.user);

                if (isAiServiceEnabled() && doc.pythonDocumentId) {
                    const synced = await syncStatusFromAiDocument(doc, orgId, req.user);
                    await doc.save();
                    aiDocument = synced;
                    job = await getDocumentJobStatus(doc.pythonDocumentId, orgId);
                    if (doc.status === 'ready') {
                        validations = await listAiValidations(orgId, doc.pythonDocumentId);
                    }
                }

                return {
                    document: doc.toObject(),
                    aiDocument,
                    job,
                    validations,
                };
            })
        );

        const summary = {
            total: documents.length,
            processing: documents.filter((d) =>
                d.document.status === 'processing' || d.document.status === 'uploaded'
            ).length,
            ready: documents.filter((d) => d.document.status === 'ready').length,
            failed: documents.filter((d) => d.document.status === 'failed').length,
        };

        res.json({ success: true, data: { summary, documents } });
    } catch (error) {
        next(error);
    }
};

export const getDocumentImages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        if (!doc.pythonDocumentId) {
            return res.json({ success: true, data: { images: [], descriptions_file: '' } });
        }

        const orgId = resolveDocumentAiOrgId(doc, req.user);
        const imagesData = await getAiDocumentImages(doc.pythonDocumentId, orgId);
        const images = imagesData?.images || [];
        const descriptionsFile = images.length
            ? `/api/docs/documents/${doc.documentId}/ai-file?path=images/${doc.pythonDocumentId}/descriptions.txt`
            : '';

        res.json({
            success: true,
            data: { images, descriptions_file: descriptionsFile },
        });
    } catch (error) {
        next(error);
    }
};

export const getDocumentSimilar = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        if (!doc.pythonDocumentId) {
            return res.json({ success: true, data: { results: [], total: 0 } });
        }

        const orgId = resolveDocumentAiOrgId(doc, req.user);
        const limit = Math.min(20, Math.max(1, parseInt((req.query.limit as string) || '5', 10)));
        const results = await getSimilarDocuments(doc.pythonDocumentId, orgId, limit);

        res.json({
            success: true,
            data: { results, total: results.length },
        });
    } catch (error) {
        next(error);
    }
};

export const streamDocumentAiFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const assetPath = String(req.query.path || '');
        if (!assetPath || assetPath.includes('..')) {
            return res.status(400).json({ success: false, message: 'Invalid path' });
        }
        if (doc.pythonDocumentId && !assetPath.includes(doc.pythonDocumentId)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const streamed = await streamAiAsset(assetPath);
        if (!streamed) {
            return res.status(404).json({ success: false, message: 'File not found' });
        }

        res.setHeader('Content-Type', streamed.contentType);
        streamed.data.pipe(res);
    } catch (error) {
        next(error);
    }
};

export const reprocessDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!hasPermission(req.user, PERMISSIONS.DOCUMENT_VIEW)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canAccessDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        if (!doc.pythonDocumentId) {
            return res.status(400).json({ success: false, message: 'Document not linked to AI model' });
        }

        const orgId = resolveDocumentAiOrgId(doc, req.user);
        doc.status = 'processing';
        doc.aiErrorMessage = null;
        await doc.save();

        await triggerDocumentReprocess(doc.pythonDocumentId, orgId);

        res.json({
            success: true,
            message: 'AI analysis started — refresh in a few seconds',
            data: {
                document: doc,
                aiDocument: null,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const deleteDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const doc = await Document.findOne({ documentId: req.params.id });
        if (!doc) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }
        if (!canDeleteDocument(req.user, doc)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        await deleteDocumentFully(doc.documentId, doc.storagePath, {
            pythonDocumentId: doc.pythonDocumentId,
            aiOrgId: resolveDocumentAiOrgId(doc, req.user),
        });
        recordActivityFromReq(req, {
            action: 'document.delete',
            category: 'document',
            resourceType: 'document',
            resourceId: doc.documentId,
            message: `Deleted ${doc.originalFilename}`,
            metadata: { filename: doc.originalFilename },
        });
        res.json({ success: true, message: 'Document and folder deleted' });
    } catch (error) {
        next(error);
    }
};
