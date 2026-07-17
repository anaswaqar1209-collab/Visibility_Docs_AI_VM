import { Request, Response, NextFunction } from 'express';
import ActivityLog from '../models/ActivityLog';
import User from '../models/User';

/**
 * Visibility:
 * - team: own activity only
 * - admin: own org (self + team members)
 * - superAdmin: own + all admins + all team members (platform)
 */
async function buildActorFilter(user: any): Promise<Record<string, unknown>> {
    if (!user) return { actorUserId: '__none__' };

    if (user.role === 'team') {
        return { actorUserId: user.userId };
    }

    if (user.role === 'admin') {
        if (!user.organizationId) {
            return { actorUserId: user.userId };
        }
        return { organizationId: user.organizationId };
    }

    if (user.role === 'superAdmin') {
        // Platform: all admin + team activity, plus this superAdmin's own
        return {
            $or: [
                { actorUserId: user.userId },
                { actorRole: { $in: ['admin', 'team'] } },
            ],
        };
    }

    return { actorUserId: user.userId };
}

export const listActivity = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
        const skip = (page - 1) * limit;

        const category = (req.query.category as string)?.trim();
        const action = (req.query.action as string)?.trim();
        const actorUserId = (req.query.actorUserId as string)?.trim();
        const q = (req.query.q as string)?.trim();
        const organizationId = (req.query.organizationId as string)?.trim();

        const scope = await buildActorFilter(req.user);
        const filter: Record<string, unknown> = { ...scope };

        // Nested $and if scope already has $or
        const andParts: Record<string, unknown>[] = [];
        if ((scope as any).$or) {
            andParts.push({ $or: (scope as any).$or });
            delete (filter as any).$or;
        }

        if (category) andParts.push({ category });
        if (action) andParts.push({ action });
        if (actorUserId) {
            // Team cannot query other users
            if (req.user.role === 'team' && actorUserId !== req.user.userId) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
            andParts.push({ actorUserId });
        }
        if (organizationId && req.user.role === 'superAdmin') {
            andParts.push({ organizationId });
        }
        if (q) {
            const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            andParts.push({
                $or: [
                    { message: rx },
                    { actorEmail: rx },
                    { actorName: rx },
                    { action: rx },
                    { resourceId: rx },
                ],
            });
        }

        const finalFilter =
            andParts.length === 0
                ? filter
                : Object.keys(filter).length
                  ? { $and: [filter, ...andParts] }
                  : andParts.length === 1
                    ? andParts[0]
                    : { $and: andParts };

        const [logs, total] = await Promise.all([
            ActivityLog.find(finalFilter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            ActivityLog.countDocuments(finalFilter),
        ]);

        // Optional actor enrichment for display names if missing
        const missingIds = [
            ...new Set(
                logs
                    .filter((l) => !l.actorName && l.actorUserId)
                    .map((l) => l.actorUserId)
            ),
        ];
        let nameMap = new Map<string, string>();
        if (missingIds.length) {
            const users = await User.find({ userId: { $in: missingIds } })
                .select('userId fullName email')
                .lean();
            nameMap = new Map(users.map((u) => [u.userId, u.fullName || u.email]));
        }

        const data = logs.map((l) => ({
            ...l,
            actorName: l.actorName || nameMap.get(l.actorUserId) || l.actorEmail || l.actorUserId,
        }));

        res.json({
            success: true,
            data: {
                logs: data,
                total,
                page,
                limit,
                totalPages: Math.max(1, Math.ceil(total / limit)),
            },
        });
    } catch (error) {
        next(error);
    }
};

/** Team members / admins list for filter dropdown (scoped). */
export const listActivityActors = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const role = req.user.role;

        if (role === 'team') {
            return res.json({
                success: true,
                data: {
                    actors: [
                        {
                            userId: req.user.userId,
                            fullName: req.user.username || req.user.email,
                            email: req.user.email,
                            role: 'team',
                        },
                    ],
                },
            });
        }

        if (role === 'admin') {
            if (!req.user.organizationId) {
                return res.json({ success: true, data: { actors: [] } });
            }
            const users = await User.find({
                organizationId: req.user.organizationId,
                role: { $in: ['admin', 'team'] },
            })
                .select('userId fullName email role')
                .sort({ fullName: 1 })
                .lean();
            return res.json({ success: true, data: { actors: users } });
        }

        // superAdmin
        const users = await User.find({
            role: { $in: ['admin', 'team', 'superAdmin'] },
        })
            .select('userId fullName email role organizationId')
            .sort({ role: 1, fullName: 1 })
            .limit(500)
            .lean();

        res.json({ success: true, data: { actors: users } });
    } catch (error) {
        next(error);
    }
};
