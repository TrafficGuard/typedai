/**
 * @deprecated Use the new API definition routes
 * Backend route paths
 */
export const API_ROUTES = {
    AUTH_ROUTE_PREFIX: '/api/auth/',
    AUTH_SIGN_IN: '/api/auth/signin',
    AUTH_SIGNUP: '/api/auth/signup',
    AUTH_CONFIRM_EMAIL: '/api/auth/confirm-email',

    // Vibe Routes
    VIBE_BASE: '/api/vibe',
    VIBE_CREATE: '/api/vibe/create', // POST
    VIBE_INITIALISE: '/api/vibe/initialise/:id', // POST {id}
    VIBE_LIST: '/api/vibe/sessions', // GET
    VIBE_GET: '/api/vibe/session/:id', // GET {id}
    VIBE_UPDATE: '/api/vibe/session/:id', // PATCH {id}
    VIBE_DELETE_SESSION: '/api/vibe/sessions/:id', // DELETE {id}
    VIBE_QUERY: '/api/vibe/query/:id', // POST {id}
};
