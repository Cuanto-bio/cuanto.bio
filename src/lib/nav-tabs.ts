import BarChart2Icon from '@lucide/svelte/icons/bar-chart-2';
import BookOpenIcon from '@lucide/svelte/icons/book-open';
import BookmarkIcon from '@lucide/svelte/icons/bookmark';
import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
import HomeIcon from '@lucide/svelte/icons/home';
import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
import UserIcon from '@lucide/svelte/icons/user';
import type { Component } from 'svelte';

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
    icon: BarChart2Icon,
  },
  {
    type: 'popover',
    key: 'explore',
    label: 'Explore',
    icon: EllipsisIcon,
    items: [
      { href: '/protocols', label: 'All Protocols', icon: BookOpenIcon },
      { href: '/surveys', label: 'All Surveys', icon: BarChart2Icon },
      { href: '/stats', label: 'Stats Explorer', icon: TrendingUpIcon },
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
    icon: BarChart2Icon,
  },
  {
    type: 'link',
    key: 'stats',
    href: '/stats',
    label: 'Stats',
    icon: TrendingUpIcon,
  },
  {
    type: 'link',
    key: 'signin',
    href: '/auth/signin',
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
