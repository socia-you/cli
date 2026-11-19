<script lang="ts">
  // Decorative background — soft grey orbs scattered around the edges.
  //
  // The composition is intentionally asymmetric: sizes, opacities, and
  // animation speeds all differ, so the background feels organic rather
  // than a grid of identical circles.
  //
  // Performance:
  //   - No `filter: blur()`. On Android WebView it is software-rendered
  //     and kills the frame rate. We use multi-stop radial gradients
  //     instead — same visual, no cost.
  //   - `position: fixed` so orbs stay put while the content scrolls.
  //   - `will-change: transform` promotes orbs to GPU layers.
  //   - Transforms only — no `top` / `left` changes in keyframes.
</script>

<div class="glow" aria-hidden="true">
  <span class="orb orb--1"></span>
  <span class="orb orb--2"></span>
  <span class="orb orb--3"></span>
  <span class="orb orb--4"></span>
  <span class="orb orb--5"></span>
  <span class="orb orb--6"></span>
  <span class="orb orb--7"></span>
</div>

<style>
  .glow {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }

  /* Shared orb base. The gradient is identical across orbs — the size
     and opacity of the element decide how bright it reads. */
  .orb {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      rgba(255, 255, 255, 0.32) 0%,
      rgba(255, 255, 255, 0.14) 25%,
      rgba(255, 255, 255, 0.04) 55%,
      transparent 80%
    );
    animation: drift 22s ease-in-out infinite;
    will-change: transform;
  }

  /* ===== ANCHOR — top-left, biggest and brightest. ===== */
  .orb--1 {
    width: 380px;
    height: 380px;
    top: -140px;
    left: -160px;
    opacity: 0.85;
    animation-duration: 26s;
    animation-delay: -3s;
  }

  /* Top-right — small and calm. Balances the anchor. */
  .orb--2 {
    width: 240px;
    height: 240px;
    top: -80px;
    right: -100px;
    opacity: 0.45;
    animation-duration: 22s;
    animation-delay: -9s;
  }

  /* Mid-right — sits off the vertical center, adds tension. */
  .orb--3 {
    width: 300px;
    height: 300px;
    top: 28%;
    right: -140px;
    opacity: 0.55;
    animation-duration: 28s;
    animation-delay: -5s;
  }

  /* Mid-left — tiny and very dim. A quiet accent. */
  .orb--4 {
    width: 160px;
    height: 160px;
    top: 52%;
    left: -60px;
    opacity: 0.30;
    animation-duration: 18s;
    animation-delay: -12s;
  }

  /* Bottom-left — mid-sized, warm-ish grey. */
  .orb--5 {
    width: 260px;
    height: 260px;
    bottom: -100px;
    left: -80px;
    opacity: 0.50;
    animation-duration: 24s;
    animation-delay: -7s;
  }

  /* Bottom-right — wide and very subtle. */
  .orb--6 {
    width: 340px;
    height: 340px;
    bottom: -140px;
    right: -120px;
    opacity: 0.40;
    animation-duration: 32s;
    animation-delay: -15s;
  }

  /* Center hint — huge, barely visible. Keeps the middle alive. */
  .orb--7 {
    width: 520px;
    height: 520px;
    top: 42%;
    left: 50%;
    transform: translate(-50%, -50%);
    opacity: 0.08;
    animation-duration: 36s;
    animation-delay: -5s;
    background: radial-gradient(
      circle,
      rgba(255, 255, 255, 0.28) 0%,
      rgba(255, 255, 255, 0.08) 40%,
      transparent 70%
    );
  }

  /* Slow, small drift. Three keyframes feel more organic than two. */
  @keyframes drift {
    0%,
    100% {
      transform: translate3d(0, 0, 0) scale(1);
    }
    33% {
      transform: translate3d(12px, -10px, 0) scale(1.04);
    }
    66% {
      transform: translate3d(-10px, 8px, 0) scale(0.97);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .orb {
      animation: none;
    }
  }
</style>