<script lang="ts">
import { afterNavigate } from '$app/navigation';
import { page } from '$app/state';
import { SIGNED_IN_TABS, SIGNED_OUT_TABS } from '$lib/nav-tabs';

let { did, avatarUrl }: { did?: string; avatarUrl?: string } = $props();

const pathname = $derived(page.url.pathname);

let moreOpen = $state(false);

afterNavigate(() => {
  moreOpen = false;
});

function activeTabSignedOut(p: string) {
  if (p === '/') return 'home';
  if (p.startsWith('/protocols')) return 'protocols';
  if (p.startsWith('/surveys')) return 'surveys';
  if (p.startsWith('/app') || p.startsWith('/auth')) return 'you';
  return null;
}

function activeTabSignedIn(p: string) {
  // /protocols (public list) maps to 'following' intentionally: signed-in users
  // reach it via the Explore popover, but the primary protocols destination is
  // the Following tab, so we keep that tab highlighted for all protocol paths.
  if (p.startsWith('/app/protocols') || p.startsWith('/protocols'))
    return 'following';
  if (p.startsWith('/app/surveys')) return 'surveys';
  if (p.startsWith('/surveys')) return 'explore';
  if (p === '/app/account' || p.startsWith('/auth')) return 'you';
  return null;
}
</script>

<nav class="mobile-nav border-t border-border bg-background">
  {#if did}
    {#each SIGNED_IN_TABS as tab (tab.key)}
      {#if tab.type === 'link'}
        {@const Icon = tab.icon}
        <a
          href={tab.href}
          class="tab"
          class:active={activeTabSignedIn(pathname) === tab.key}
        >
          {#if tab.key === 'you' && avatarUrl}
            <img src={avatarUrl} alt="" class="h-[22px] w-[22px] rounded-full object-cover" />
          {:else}
            <Icon size={22} />
          {/if}
          <span class="text-[0.6rem] font-bold tracking-wide">{tab.label}</span>
        </a>
      {:else}
        {@const Icon = tab.icon}
        <div class="relative flex flex-1">
          <button
            class="tab flex-1"
            class:active={activeTabSignedIn(pathname) === tab.key || moreOpen}
            onclick={() => (moreOpen = !moreOpen)}
            aria-haspopup="true"
            aria-expanded={moreOpen}
          >
            <Icon size={22} />
            <span class="text-[0.6rem] font-bold tracking-wide">{tab.label}</span>
          </button>
          {#if moreOpen}
            <div
              class="more-popover border-border bg-background rounded-[10px] border p-1 shadow-lg"
              role="menu"
            >
              {#each tab.items as item (item.href)}
                {@const ItemIcon = item.icon}
                <a
                  href={item.href}
                  class="hover:bg-muted text-foreground flex items-center gap-2 rounded-[7px] px-3 py-2.5 text-sm font-bold no-underline transition-colors"
                  role="menuitem"
                >
                  <ItemIcon size={16} />
                  {item.label}
                </a>
              {/each}
            </div>
            <!-- z-49: sits below the popover (z-50) but above page content -->
            <div
              class="fixed inset-0 z-49"
              role="presentation"
              onclick={() => (moreOpen = false)}
            ></div>
          {/if}
        </div>
      {/if}
    {/each}
  {:else}
    {#each SIGNED_OUT_TABS as tab (tab.key)}
      {@const Icon = tab.icon}
      <a
        href={tab.href}
        class="tab"
        class:active={activeTabSignedOut(pathname) === tab.key}
      >
        <Icon size={22} />
        <span class="text-[0.6rem] font-bold tracking-wide">{tab.label}</span>
      </a>
    {/each}
  {/if}
</nav>

<style>
  /* Only what Tailwind can't express */

  .mobile-nav {
    display: none;
  }

  @media (max-width: 767px) and (pointer: coarse) {
    .mobile-nav {
      display: flex;
      flex-shrink: 0;
      height: calc(60px + env(safe-area-inset-bottom, 0px));
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }

    .more-popover {
      position: fixed;
      bottom: calc(60px + env(safe-area-inset-bottom, 0px) + 8px);
      left: 50%;
      transform: translateX(-25%);
      z-index: 50;
      min-width: 160px;
    }
  }

  .tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    text-decoration: none;
    color: var(--muted-foreground);
    transition: color 0.15s;
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-family: inherit;
  }

  .tab.active {
    color: var(--sidebar-primary);
  }

  /* ::before can't be done with Tailwind */
  .tab.active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 32px;
    height: 2px;
    background: var(--primary);
    border-radius: 0 0 2px 2px;
  }
</style>
