import seedData from '../../data.json';

import { DEFAULT_DURATION_MINUTES, humanizeIdentifier, type IrrigationAppState, type IrrigationProgram } from './shared';

const seedGroups = seedData as Record<string, string[]>;

function createSeedProgram(groupId: string, entityIds: string[], order: number): IrrigationProgram {
    return {
        id: `${groupId}:${order}`,
        name: humanizeIdentifier(groupId),
        enabled: true,
        startTime: '06:00',
        days: ['mon', 'wed', 'fri'],
        zones: entityIds.map((entityId, zoneOrder) => ({
            id: `${groupId}:${zoneOrder}:${entityId}`,
            entityId,
            label: humanizeIdentifier(entityId),
            durationMinutes: DEFAULT_DURATION_MINUTES,
            enabled: true
        }))
    };
}

export function createSeedState(): IrrigationAppState {
    return {
        settings: {
            homeAssistantUrl: '',
            accessToken: '',
            defaultDurationMinutes: DEFAULT_DURATION_MINUTES
        },
        programs: Object.entries(seedGroups).map(([groupId, entityIds], index) =>
            createSeedProgram(groupId, entityIds, index)
        ),
        updatedAt: new Date().toISOString()
    };
}