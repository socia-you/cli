<script lang="ts">
  import Card from '../../shared/ui/Card.svelte'
  import { socia } from '../../shared/lib/socia'

  let lastResult = $state<string | null>(null)

  async function openTestSheet() {
    try {
      const res = await socia.ui.showSheet({
        title: 'Test sheet',
        helpText:
          'This is a native Socia sheet rendered by the Flutter host. ' +
          'The mini app only describes fields and buttons.',
        fields: [
          {
            type: 'text',
            name: 'name',
            label: 'Name',
            placeholder: 'Your name',
          },
          {
            type: 'textarea',
            name: 'message',
            label: 'Message',
            placeholder: 'Write something…',
          },
        ],
        actions: [{ id: 'save', label: 'Save', style: 'primary' }],
      })

      lastResult = `sheet → action: ${res.action}\nvalues: ${JSON.stringify(res.values, null, 2)}`
    } catch {
      lastResult = 'sheet → cancelled'
    }
  }

  async function testConfirm() {
    const ok = await socia.ui.confirm({
      title: 'Delete note?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    })

    lastResult = `confirm → ${ok}`
  }
</script>

<section class="page">
  <header class="hero">
    <h1>Welcome to your<br />Sphere app.</h1>
    <p>
      Edit the files under <code>src/</code> and run
      <code>socia deploy</code> to publish a new version.
    </p>
  </header>

  <Card title="Try the host API">
    <p class="text">
      Tap a button below to open a native Socia modal. Both are
      rendered by the Flutter host — the mini app only sends a JSON
      description.
    </p>

    <button class="socia-btn" type="button" onclick={openTestSheet}>
      Open test sheet
    </button>

    <button
      class="socia-btn socia-btn--secondary"
      type="button"
      onclick={testConfirm}
    >
      Test confirm
    </button>

    {#if lastResult}
      <pre class="result">{lastResult}</pre>
    {/if}
  </Card>

  <Card title="Getting started">
    <ul class="steps">
      <li>Edit <code>src/pages/home/HomePage.svelte</code></li>
      <li>Add new pages under <code>src/pages/</code></li>
      <li>Register tabs in <code>manifest.json</code></li>
      <li>Call the host API via <code>socia.api.get('/users/me')</code></li>
    </ul>
  </Card>

  <Card title="Read me first">
    <p class="text">
      Two files explain everything: <code>README.md</code> for you,
      <code>AI.md</code> for a language model. Both are in the
      project root.
    </p>
  </Card>
</section>

<style>
  /* Kill the browser's default blue highlight and focus ring.
     They clash with the dark UI. */
  :global(*),
  :global(*::before),
  :global(*::after) {
    -webkit-tap-highlight-color: transparent;
  }

  :global(button),
  :global(input),
  :global(textarea) {
    outline: none;
  }

  :global(button:focus),
  :global(button:focus-visible) {
    outline: none;
    box-shadow: none;
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 8px 4px 4px;
  }

  h1 {
    font-size: 30px;
    line-height: 1.15;
    font-weight: 700;
    letter-spacing: -0.6px;
    color: #fff;
  }

  p {
    color: rgba(255, 255, 255, 0.55);
    font-size: 15px;
    line-height: 1.55;
  }

  .steps {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .steps li {
    position: relative;
    padding-left: 22px;
    font-size: 14px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.72);
  }

  .steps li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.55);
  }

  .text {
    color: rgba(255, 255, 255, 0.55);
    font-size: 14px;
    line-height: 1.6;
  }

  /* PrimaryButton — one-to-one with Flutter's PrimaryButton. */
  .socia-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 56px;
    margin-top: 14px;
    padding: 0 24px;
    font-family: inherit;
    font-size: 16px;
    font-weight: 600;
    color: #000000;
    background: #ffffff;
    border: none;
    border-radius: 95px;
    cursor: pointer;
    box-shadow: 0 0 40px rgba(255, 255, 255, 0.12);
    transition: opacity 0.15s ease, transform 0.08s ease;
    -webkit-tap-highlight-color: transparent;
    outline: none;
  }

  .socia-btn:hover {
    opacity: 0.92;
  }

  .socia-btn:active {
    transform: scale(0.98);
  }

  .socia-btn:focus,
  .socia-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 40px rgba(255, 255, 255, 0.12);
  }

  /* Secondary button — transparent, thin border. */
  .socia-btn--secondary {
    background: transparent;
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: none;
  }

  .socia-btn--secondary:hover {
    background: rgba(255, 255, 255, 0.05);
    opacity: 1;
  }

  .socia-btn--secondary:focus,
  .socia-btn--secondary:focus-visible {
    box-shadow: none;
  }

  .result {
    margin-top: 18px;
    padding: 14px 16px;
    border-radius: 16px;
    background: #0A0A0A;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.75);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>