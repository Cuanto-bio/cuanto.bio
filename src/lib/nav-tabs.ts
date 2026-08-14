import BookOpenIcon from '@lucide/svelte/icons/book-open';
import BookmarkIcon from '@lucide/svelte/icons/bookmark';
import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
import ClipboardListIcon from '@lucide/svelte/icons/clipboard-list';
import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
import HomeIcon from '@lucide/svelte/icons/home';
import InfoIcon from '@lucide/svelte/icons/info';
import ListChecksIcon from '@lucide/svelte/icons/list-checks';
import UserIcon from '@lucide/svelte/icons/user';
import type { Component } from 'svelte';
import { signInPath } from '$lib/auth/signin';

export type LinkTab = {
  type: 'link';
  key: string;
  href: string;
  label: string;
  icon: Component;
};

export type PopoverItem = {
  href: string;
  label: string;
  icon: Component;
};

// The Explore tab is a button that opens a popover rather than a direct link.
export type PopoverTab = {
  type: 'popover';
  key: string;
  label: string;
  icon: Component;
  items: PopoverItem[];
};

export type Tab = LinkTab | PopoverTab;

export const SIGNED_IN_TABS: Tab[] = [
  {
    type: 'link',
    key: 'following',
    href: '/app/protocols/following',
    label: 'Following',
    icon: BookmarkIcon,
  },
  {
    type: 'link',
    key: 'surveys',
    href: '/app/surveys',
    label: 'Your Surveys',
    icon: ClipboardListIcon,
  },
  {
    type: 'popover',
    key: 'explore',
    label: 'Explore',
    icon: EllipsisIcon,
    items: [
      { href: '/protocols', label: 'All Protocols', icon: ListChecksIcon },
      { href: '/surveys', label: 'All Surveys', icon: ClipboardListIcon },
      { href: '/stats', label: 'Stats Explorer', icon: ChartColumnIcon },
      { href: '/about', label: 'About', icon: InfoIcon },
    ],
  },
  {
    type: 'link',
    key: 'you',
    href: '/app/account',
    label: 'You',
    icon: UserIcon,
  },
];

export const SIGNED_OUT_TABS: LinkTab[] = [
  { type: 'link', key: 'home', href: '/', label: 'Home', icon: HomeIcon },
  {
    type: 'link',
    key: 'protocols',
    href: '/protocols',
    label: 'Protocols',
    icon: BookOpenIcon,
  },
  {
    type: 'link',
    key: 'surveys',
    href: '/surveys',
    label: 'Surveys',
    icon: ClipboardListIcon,
  },
  {
    type: 'link',
    key: 'stats',
    href: '/stats',
    label: 'Stats',
    icon: ChartColumnIcon,
  },
  {
    type: 'link',
    key: 'signin',
    // Native has no /auth/signin in its bundle; signInPath() sends it to
    // /app/signin instead. See $lib/auth/signin.ts.
    href: signInPath(),
    label: 'Sign in',
    icon: UserIcon,
  },
];

// All top-level nav destinations. Used by the mobile header to suppress the
// back link on pages that are navigation roots rather than detail pages.
export const BASE_ROUTES = [
  ...SIGNED_IN_TABS.flatMap((t) =>
    t.type === 'popover' ? t.items.map((i) => i.href) : [t.href],
  ),
  ...SIGNED_OUT_TABS.map((t) => t.href),
];
