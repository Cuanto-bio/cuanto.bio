<script lang="ts">
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';
</script>

<main class="flex min-h-screen items-center justify-center">
  <Card.Root class="w-96">
    <Card.Header>
      <Card.Title>Sign in</Card.Title>
      <Card.Description>Enter your AT Protocol handle to continue.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" class="flex flex-col gap-4">
        <Input
          type="text"
          name="handle"
          placeholder="you.bsky.social"
          autocomplete="username"
          required
        />
        <Button type="submit">Sign in</Button>
      </form>
    </Card.Content>
  </Card.Root>
</main>
