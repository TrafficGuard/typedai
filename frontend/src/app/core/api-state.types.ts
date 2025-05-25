// Example: routes/entities.routes.ts
const BASE = '/ui/entities';

export const ENTITIES_ROUTES = {
  segments: {
    list: '',
    new: 'new',
    detail: ':entityId',
    edit: ':entityId/edit',
  },
  nav: {
    list: () => [BASE],
    new: () => [BASE, 'new'],
    detail: (id: string) => [BASE, id],
    edit: (id: string) => [BASE, id, 'edit'],
  }
} as const;
