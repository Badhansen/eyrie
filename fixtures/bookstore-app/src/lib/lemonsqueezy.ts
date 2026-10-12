import { createCheckout, lemonSqueezySetup } from '@lemonsqueezy/lemonsqueezy.js';

lemonSqueezySetup({ apiKey: process.env.LEMONSQUEEZY_API_KEY ?? '' });

/** The SDK exports loose functions, so the app gets one client object to call. */
export const lemonSqueezy = { createCheckout };
