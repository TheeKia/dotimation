import { useEffect, useLayoutEffect } from 'react'

/**
 * useLayoutEffect warns under server rendering; the server branch runs no
 * effects anyway, so substituting useEffect is purely warning suppression.
 */
export const useIsomorphicLayoutEffect: typeof useEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect
