<script lang="ts">
import { Button } from '$lib/components/ui/button/index.js';
import Wordmark from '$lib/components/wordmark.svelte';

let { data } = $props();
</script>

<section class="hero">
  <div class="bg-dots" aria-hidden="true"></div>
  <div class="bg-halo" aria-hidden="true"></div>

  <div class="content">
    <h1 class="wordmark"><Wordmark /></h1>
    <p class="tagline">Everything counts!</p>

    <p class="description">
      Help monitor biodiversity over time by counting organisms!
      Researchers design protocols to follow, and volunteers get outside and conduct surveys
      according to those protocols.
    </p>

    <div class="flex flex-col items-center justify-center gap-4 my-6 max-w-3/4 mx-auto">
      <Button href="/auth/signin" class="w-full">
        Start Counting!
      </Button>
      <Button variant="outline" href="/protocols" class="w-full">
        Explore Protocols
      </Button>
    </div>
  </div>
</section>

<style>
  .hero {
    position: relative;
    min-height: calc(100dvh - 48px);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: oklch(1 0 0);
  }

  .bg-dots {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(
      circle,
      oklch(0.852 0.199 91.936 / 0.3) 1.5px,
      transparent 1.5px
    );
    background-size: 28px 28px;
    animation: fade-in 1.4s ease forwards;
  }

  .bg-halo {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -58%);
    width: 900px;
    height: 600px;
    background: radial-gradient(
      ellipse,
      oklch(0.852 0.199 91.936 / 0.26) 0%,
      transparent 68%
    );
    pointer-events: none;
    animation: fade-in 1.2s ease forwards;
  }

  .content {
    position: relative;
    text-align: center;
    padding: 2rem 1.5rem;
    max-width: 680px;
    width: 100%;
  }

  .wordmark {
    font-size: clamp(2.75rem, 9vw, 6.5rem);
    letter-spacing: -0.01em;
    line-height: 1;
    text-wrap: nowrap;
    text-shadow:
      0 2px 0 oklch(0.852 0.199 91.936 / 0.45),
      0 6px 24px oklch(0.852 0.199 91.936 / 0.25);
    animation: rise-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    opacity: 0;
  }

  .tagline {
    font-family: 'DynaPuff Variable', 'Nunito Variable', sans-serif;
    font-size: clamp(0.8125rem, 1.8vw, 1.0625rem);
    color: var(--color-accent-foreground);
    letter-spacing: 0.32em;
    margin: 1.25rem 0;
    animation: rise-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.15s forwards;
    opacity: 0;
  }

  .description {
    font-size: 1.0625rem;
    line-height: 1.8;
    color: oklch(0.45 0.01 58);
    max-width: 500px;
    margin: 0 auto;
    animation: rise-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.45s forwards;
    opacity: 0;
  }

  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
