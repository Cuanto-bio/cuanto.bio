<script lang="ts">
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '$lib/components/ui/sidebar';

let { did, handle }: { did?: string; handle?: string } = $props();
</script>

<Sidebar>
  <SidebarHeader>
    Cuanto.bio
  </SidebarHeader>
  <SidebarContent>
    <SidebarGroup>
      <SidebarGroupLabel>Everyone</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href="/protocols" {...props}>All Protocols</a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              {#snippet child({ props })}
                <a href="/surveys" {...props}>All Surveys</a>
              {/snippet}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>

    {#if did}
      <SidebarGroup>
        <SidebarGroupLabel>You</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {#if handle}
              <SidebarMenuItem>
                <SidebarMenuButton>
                  {#snippet child({ props })}
                    <a href="/protocols/{handle}" {...props}>Your Protocols</a>
                  {/snippet}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  {#snippet child({ props })}
                    <a href="/surveys/{handle}" {...props}>Your Surveys</a>
                  {/snippet}
                </SidebarMenuButton>
              </SidebarMenuItem>
            {/if}
            <SidebarMenuItem>
              <SidebarMenuButton>
                {#snippet child({ props })}
                  <a href="/protocols/new" {...props}>New Protocol</a>
                {/snippet}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    {/if}
  </SidebarContent>

  <SidebarFooter>
    {#if handle}
      <p class="text-muted-foreground px-2 text-xs font-bold">@{handle}</p>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>
            {#snippet child({ props })}
              <a href="/auth/signout" {...props}>Sign out</a>
            {/snippet}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    {:else}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton>
            {#snippet child({ props })}
              <a href="/auth/signin" {...props}>Sign in</a>
            {/snippet}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    {/if}
  </SidebarFooter>
</Sidebar>
