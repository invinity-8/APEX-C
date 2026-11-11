/** Size classes → scale of a miniature (a medium creature is 1). */
const SIZE: Record<string, number> = { tiny: 0.45, small: 0.75, medium: 1, large: 1.9, huge: 2.8, gargantuan: 3.8 };
export const sizeScale = (size?: string) => SIZE[(size ?? 'medium').toLowerCase()] ?? 1;
