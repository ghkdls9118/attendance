export const roleOf = () => (typeof document !== 'undefined' ? document.querySelector('[data-role]')?.getAttribute('data-role') : null)
