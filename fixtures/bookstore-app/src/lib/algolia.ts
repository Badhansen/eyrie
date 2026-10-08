import { algoliasearch } from 'algoliasearch';

export const search = algoliasearch(process.env.ALGOLIA_APP_ID ?? '', process.env.ALGOLIA_API_KEY ?? '');
