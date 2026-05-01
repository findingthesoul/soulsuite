"use client";

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, type ComponentPropsWithoutRef } from "react";

// Link that disables Next's default in-viewport prefetching and triggers a manual
// router.prefetch on hover/focus instead. Better signal than viewport for long lists —
// we only spend network on rows the user is actually about to click.
//
// Drop-in replacement for <Link> on list rows where the target is a dynamic route with a
// loading.tsx (so router.prefetch can preload the loading state + RSC payload).
//
// Falls back to native <Link> behaviour for everything else: same href, same className,
// same accessibility (it's still an <a>).

type Props = LinkProps &
  Omit<ComponentPropsWithoutRef<"a">, keyof LinkProps> & {
    children: React.ReactNode;
  };

export function PrefetchLink({ href, children, onMouseEnter, onFocus, prefetch, ...rest }: Props) {
  const router = useRouter();
  const hasPrefetched = useRef(false);

  const trigger = useCallback(() => {
    if (hasPrefetched.current) return;
    hasPrefetched.current = true;
    if (typeof href === "string") router.prefetch(href);
  }, [router, href]);

  return (
    <Link
      href={href}
      prefetch={prefetch ?? false}
      onMouseEnter={(e) => {
        trigger();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        trigger();
        onFocus?.(e);
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
