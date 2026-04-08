import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createSeedState } from '../seed';
import { normalizeState, type IrrigationAppState } from '../shared';

const dataDirectory = process.env.IRRIGATION_APP_DATA_DIR ?? path.join(process.cwd(), '.irrigation-data');
const stateFilePath = path.join(dataDirectory, 'state.json');

export async function readAppState(): Promise<IrrigationAppState> {
    try {
        const contents = await readFile(stateFilePath, 'utf8');
        const parsedState = normalizeState(JSON.parse(contents));

        if (parsedState.programs.length === 0) {
            const seededState = normalizeState({
                ...parsedState,
                programs: createSeedState().programs
            });
            await writeAppState(seededState);
            return seededState;
        }

        return parsedState;
    } catch (error) {
        if (isMissingFileError(error)) {
            const initialState = normalizeState(createSeedState());
            await writeAppState(initialState);
            return initialState;
        }

        throw error;
    }
}

export async function writeAppState(state: IrrigationAppState): Promise<IrrigationAppState> {
    const normalizedState = normalizeState({
        ...state,
        updatedAt: new Date().toISOString()
    });

    await mkdir(dataDirectory, { recursive: true });
    await writeFile(stateFilePath, `${JSON.stringify(normalizedState, null, 2)}\n`, 'utf8');

    return normalizedState;
}

function isMissingFileError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}