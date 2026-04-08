import { EntitySchema } from 'typeorm';

export interface ProgramRecord {
    id: string;
    name: string;
    enabled: boolean;
    startTime: string;
    daysCsv: string;
    sortOrder: number;
}

export interface ZoneRecord {
    id: string;
    programId: string;
    entityId: string;
    label: string;
    durationMinutes: number;
    enabled: boolean;
    sortOrder: number;
}

export interface SettingRecord {
    key: string;
    value: string;
}

export interface MetaRecord {
    key: string;
    value: string;
}

export interface ProgramEventRecord {
    id: string;
    programId: string | null;
    level: 'info' | 'warning' | 'error';
    message: string;
    payload: string | null;
    createdAt: string;
}

export type ProgramRunStatus = 'pending' | 'running' | 'completed' | 'completed_with_errors';

export interface ProgramRunRecord {
    id: string;
    programId: string;
    scheduledFor: string;
    status: ProgramRunStatus;
    nextZoneIndex: number;
    retryCount: number;
    retryAt: string | null;
    activeZoneId: string | null;
    lastError: string | null;
    hadErrors: boolean;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
    updatedAt: string;
}

export const ProgramSchema = new EntitySchema<ProgramRecord>({
    name: 'ProgramRecord',
    tableName: 'programs',
    columns: {
        id: { type: String, primary: true },
        name: { type: String },
        enabled: { type: Boolean },
        startTime: { type: String },
        daysCsv: { type: String },
        sortOrder: { type: Number }
    }
});

export const ZoneSchema = new EntitySchema<ZoneRecord>({
    name: 'ZoneRecord',
    tableName: 'zones',
    columns: {
        id: { type: String, primary: true },
        programId: { type: String },
        entityId: { type: String },
        label: { type: String },
        durationMinutes: { type: Number },
        enabled: { type: Boolean },
        sortOrder: { type: Number }
    },
    indices: [
        {
            columns: ['programId', 'sortOrder']
        }
    ]
});

export const SettingSchema = new EntitySchema<SettingRecord>({
    name: 'SettingRecord',
    tableName: 'settings',
    columns: {
        key: { type: String, primary: true },
        value: { type: String }
    }
});

export const MetaSchema = new EntitySchema<MetaRecord>({
    name: 'MetaRecord',
    tableName: 'meta',
    columns: {
        key: { type: String, primary: true },
        value: { type: String }
    }
});

export const ProgramEventSchema = new EntitySchema<ProgramEventRecord>({
    name: 'ProgramEventRecord',
    tableName: 'program_events',
    columns: {
        id: { type: String, primary: true },
        programId: { type: String, nullable: true },
        level: { type: String },
        message: { type: String },
        payload: { type: String, nullable: true },
        createdAt: { type: String }
    },
    indices: [
        {
            columns: ['programId', 'createdAt']
        }
    ]
});

export const ProgramRunSchema = new EntitySchema<ProgramRunRecord>({
    name: 'ProgramRunRecord',
    tableName: 'program_runs',
    columns: {
        id: { type: String, primary: true },
        programId: { type: String },
        scheduledFor: { type: String },
        status: { type: String },
        nextZoneIndex: { type: Number },
        retryCount: { type: Number },
        retryAt: { type: String, nullable: true },
        activeZoneId: { type: String, nullable: true },
        lastError: { type: String, nullable: true },
        hadErrors: { type: Boolean },
        createdAt: { type: String },
        startedAt: { type: String, nullable: true },
        completedAt: { type: String, nullable: true },
        updatedAt: { type: String }
    },
    indices: [
        {
            columns: ['programId', 'scheduledFor'],
            unique: true
        },
        {
            columns: ['status', 'retryAt']
        },
        {
            columns: ['status', 'scheduledFor']
        }
    ]
});
