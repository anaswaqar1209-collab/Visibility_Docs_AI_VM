import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import User, { defaultPermissionsForRole } from '../models/User';
import Organization from '../models/Organization';
import openRemoteService from '../services/openRemoteService';
import logger from '../utils/logger';
import { TEAM_MEMBER_EDITABLE_PERMISSIONS } from '../types/permissions';
import { normalizeTeamPermissions, permissionsToPlain, pickEditableTeamPermissions, buildFlatPermissionsDocument } from '../utils/permissionsUtil';
import { recordActivityFromReq } from '../services/activityLog';

function generateUserId() {
    return `usr_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function buildUniqueUsername(email: string): Promise<string> {
    const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || 'user';
    let candidate = base;
    let i = 0;
    while (await User.findOne({ username: candidate })) {
        i += 1;
        candidate = `${base}_${i}`;
    }
    return candidate;
}

export const listMembers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const members = await User.find({
            organizationId: req.user.organizationId,
            role: 'team',
        })
            .select('-passwordHash -openRemoteSecret')
            .sort({ createdAt: -1 })
            .lean();

        const normalized = members.map((m) => ({
            ...m,
            permissions: pickEditableTeamPermissions(m.permissions),
        }));

        res.json({ success: true, data: { members: normalized } });
    } catch (error) {
        next(error);
    }
};

export const createMember = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { email, password, fullName, permissions } = req.body;
        const normalizedEmail = (email || '').toString().trim().toLowerCase();
        if (!normalizedEmail || !password || !fullName) {
            return res.status(400).json({ success: false, message: 'fullName, email and password are required' });
        }
        if (!req.user.organizationId) {
            return res.status(400).json({ success: false, message: 'Admin has no organization' });
        }

        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Email already exists' });
        }

        const username = await buildUniqueUsername(normalizedEmail);
        const userId = generateUserId();
        const passwordHash = await bcrypt.hash(password, 12);

        let openRemoteUserId: string | undefined;
        let openRemoteSecret: string | undefined;
        let openRemoteRealm = req.user.openRemoteRealm || 'personal';
        let openRemoteSynced = false;

        const openRemoteEnabled = process.env.OPENREMOTE_ENABLED !== 'false';
        const allowLocalSeed = process.env.ALLOW_LOCAL_SEED === 'true';

        if (openRemoteEnabled) {
            if (!req.user.openRemoteRealm && req.user.organizationId) {
                const org = await Organization.findOne({ organizationId: req.user.organizationId }).lean();
                if (org?.openRemoteRealm) {
                    openRemoteRealm = org.openRemoteRealm;
                } else if (org?.organizationName) {
                    openRemoteRealm = org.organizationName
                        .toLowerCase()
                        .trim()
                        .replace(/[^a-z0-9_]/g, '_')
                        .replace(/_+/g, '_')
                        .slice(0, 40) || 'enterprise';
                }
            }

            let openRemoteResult: any;
            try {
                const org = req.user.organizationId
                    ? await Organization.findOne({ organizationId: req.user.organizationId }).lean()
                    : null;
                const ensuredRealm = await openRemoteService.ensureRealmExists(
                    openRemoteRealm,
                    org?.organizationName || openRemoteRealm
                );
                await openRemoteService.retryWithBackoff(async () => {
                    openRemoteResult = await openRemoteService.createUser({
                        username,
                        email: normalizedEmail,
                        fullName,
                        role: 'team',
                        realm: ensuredRealm,
                    });
                }, 2, 500);

                openRemoteUserId = openRemoteResult?.userId || undefined;
                openRemoteSecret = openRemoteResult?.openRemoteSecret || undefined;
                if (openRemoteResult?.realm) openRemoteRealm = openRemoteResult.realm;
                openRemoteSynced = !!openRemoteUserId;
            } catch (e: any) {
                if (!allowLocalSeed) {
                    logger.error(`OpenRemote team create failed for ${username}: ${e.message}`);
                    return res.status(502).json({
                        success: false,
                        message: 'Failed to create user in OpenRemote. Member was not saved in MongoDB.',
                        error: e.message,
                    });
                }
                logger.warn(`OpenRemote team create skipped (ALLOW_LOCAL_SEED): ${e.message}`);
            }
        } else if (!allowLocalSeed) {
            return res.status(503).json({
                success: false,
                message: 'OpenRemote integration is disabled. Team member creation is blocked.',
            });
        }

        const memberPerms = { ...defaultPermissionsForRole('team'), ...(permissions || {}) };
        const member = await User.create({
            userId,
            username,
            fullName,
            email: normalizedEmail,
            passwordHash,
            role: 'team',
            accountType: 'enterprise',
            organizationId: req.user.organizationId,
            createdBy: req.user.userId,
            permissions: memberPerms,
            openRemoteRealm,
            openRemoteSynced,
            openRemoteSyncedAt: openRemoteSynced ? new Date() : undefined,
            openRemoteUserId,
            openRemoteSecret,
        });

        res.status(201).json({
            success: true,
            message: openRemoteSynced
                ? 'Team member created in OpenRemote and database'
                : 'Team member created in database only (OpenRemote unavailable)',
            data: {
                member: await User.findOne({ userId: member.userId }).select('-passwordHash -openRemoteSecret').lean(),
                openRemoteSynced,
                openRemoteUserId: openRemoteUserId || null,
            },
        });
        recordActivityFromReq(req, {
            action: 'team.member.create',
            category: 'team',
            resourceType: 'user',
            resourceId: member.userId,
            message: `Added team member ${member.email}`,
            metadata: { email: member.email, fullName: member.fullName },
        });
    } catch (error) {
        next(error);
    }
};

export const updateMember = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const member = await User.findOne({
            userId: req.params.userId,
            organizationId: req.user.organizationId,
            role: 'team',
        });
        if (!member) {
            return res.status(404).json({ success: false, message: 'Team member not found' });
        }

        const { fullName, email, contactNumber } = req.body;
        if (fullName) member.fullName = fullName;
        if (contactNumber !== undefined) member.contactNumber = contactNumber;
        if (email) {
            const normalized = email.toString().trim().toLowerCase();
            const dup = await User.findOne({ email: normalized, userId: { $ne: member.userId } });
            if (dup) return res.status(409).json({ success: false, message: 'Email already in use' });
            member.email = normalized;
        }
        await member.save();
        res.json({ success: true, data: { member: await User.findById(member._id).select('-passwordHash -openRemoteSecret').lean() } });
    } catch (error) {
        next(error);
    }
};

export const updateMemberStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { status } = req.body;
        if (!['active', 'blocked'].includes(status)) {
            return res.status(400).json({ success: false, message: 'status must be active or blocked' });
        }
        const member = await User.findOneAndUpdate(
            { userId: req.params.userId, organizationId: req.user.organizationId, role: 'team' },
            { status },
            { new: true }
        ).select('-passwordHash -openRemoteSecret');
        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });
        recordActivityFromReq(req, {
            action: 'team.member.status',
            category: 'team',
            resourceType: 'user',
            resourceId: member.userId,
            message: `Set ${member.email} status to ${status}`,
            metadata: { status },
        });
        res.json({ success: true, data: { member } });
    } catch (error) {
        next(error);
    }
};

export const updateMemberPermissions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const incoming = req.body?.permissions ?? req.body ?? {};
        const member = await User.findOne({
            userId: req.params.userId,
            organizationId: req.user.organizationId,
            role: 'team',
        })
            .select('permissions')
            .lean();

        if (!member) return res.status(404).json({ success: false, message: 'Team member not found' });

        const current = permissionsToPlain(member.permissions);
        const merged: Record<string, boolean> = { ...current };

        for (const key of TEAM_MEMBER_EDITABLE_PERMISSIONS) {
            if (typeof incoming[key] === 'boolean') merged[key] = incoming[key];
        }

        const nextPerms = normalizeTeamPermissions(merged);
        const flatPermissions = buildFlatPermissionsDocument(nextPerms);

        const saved = await User.findOneAndUpdate(
            {
                userId: req.params.userId,
                organizationId: req.user.organizationId,
                role: 'team',
            },
            { $set: { permissions: flatPermissions } },
            { new: true }
        )
            .select('-passwordHash -openRemoteSecret')
            .lean();

        res.json({
            success: true,
            data: {
                member: saved
                    ? { ...saved, permissions: pickEditableTeamPermissions(saved.permissions) }
                    : null,
            },
        });
        recordActivityFromReq(req, {
            action: 'team.member.permissions',
            category: 'team',
            resourceType: 'user',
            resourceId: String(req.params.userId),
            message: `Updated permissions for team member ${req.params.userId}`,
            metadata: { permissions: nextPerms },
        });
    } catch (error) {
        next(error);
    }
};

export const deleteMember = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await User.deleteOne({
            userId: req.params.userId,
            organizationId: req.user.organizationId,
            role: 'team',
        });
        if (!result.deletedCount) {
            return res.status(404).json({ success: false, message: 'Team member not found' });
        }
        recordActivityFromReq(req, {
            action: 'team.member.delete',
            category: 'team',
            resourceType: 'user',
            resourceId: String(req.params.userId),
            message: `Removed team member ${req.params.userId}`,
        });
        res.json({ success: true, message: 'Team member deleted' });
    } catch (error) {
        next(error);
    }
};
