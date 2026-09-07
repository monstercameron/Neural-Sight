export function cinematicDof(enabled, strength, focusDistance, ads = false) {
  const amount = Math.max(0, Math.min(1.5, Number(strength) || 0));
  const focus = Math.max(6, Math.min(30, Number(focusDistance) || 14));
  return {
    enabled: !!enabled && amount > 0,
    nearBlur: true,
    focusDistance: focus,
    focusRange: Math.min(12, focus * 1.2),
    blurRadius: amount * 3,
    foregroundRadius: enabled ? amount * (ads ? 2.4 : 3.5) : 0,
  };
}
