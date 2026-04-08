import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { DataSource } from 'typeorm';

import { MetaSchema, ProgramEventSchema, ProgramRunSchema, ProgramSchema, SettingSchema, ZoneSchema } from './entities';

const dataDirectory = process.env.IRRIGATION_APP_DATA_DIR ?? path.join(process.cwd(), '.irrigation-data');
const databaseFilePath = path.join(dataDirectory, 'state.sqlite');

const appDataSource = new DataSource({
    type: 'sqlite',
    database: databaseFilePath,
    entities: [ProgramSchema, ZoneSchema, SettingSchema, MetaSchema, ProgramEventSchema, ProgramRunSchema],
    synchronize: true,
    logging: false
});

let initializationPromise: Promise<DataSource> | null = null;

export async function getAppDataSource(): Promise<DataSource> {
    if (!initializationPromise) {
        initializationPromise = initializeDataSource();
    }

    return initializationPromise;
}

async function initializeDataSource(): Promise<DataSource> {
    await mkdir(dataDirectory, { recursive: true });

    if (appDataSource.isInitialized) {
        return appDataSource;
    }

    return appDataSource.initialize();
}
