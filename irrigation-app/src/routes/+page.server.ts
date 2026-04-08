import type { PageServerLoad } from './$types';

import { readAppState } from '$lib/server/storage';

export const load: PageServerLoad = async () => {
    const state = await readAppState();

    return {
        state
    };
};