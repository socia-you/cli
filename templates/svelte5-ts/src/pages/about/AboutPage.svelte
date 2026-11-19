<script lang="ts">
  import { onMount } from 'svelte'
  import Card from '../../shared/ui/Card.svelte'
  import { socia, type SociaContext } from '../../shared/lib/socia'

  let ctx = $state<SociaContext | null>(null)
  let loading = $state(true)

  onMount(async () => {
    ctx = await socia.context.get()
    loading = false
  })

  // Shorten a hex id for display: "2a65f0c0…9661fe96"
  function shortId(id: string): string {
    if (!id) return '—'
    if (id.length <= 16) return id
    return `${id.slice(0, 8)}…${id.slice(-8)}`
  }

  let displayName = $derived.by(() => {
    if (!ctx) return '—'
    const parts = [ctx.firstName, ctx.lastName].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : 'Anonymous'
  })
</script>

<section class="page">
  <header class="head">
    <h1>About</h1>
    <p>The current user's context inside this mini app.</p>
  </header>

  <Card title="User">
    {#if loading}
      <p class="text">Loading…</p>
    {:else if !ctx || !ctx.sphereUserId}
      <p class="text">Context unavailable.</p>
    {:else}
      <div class="user">
        {#if ctx.avatarUrl}
          <img class="avatar" src={ctx.avatarUrl} alt="avatar" />
        {:else}
          <div class="avatar avatar--fallback">
            {displayName.charAt(0).toUpperCase()}
          </div>
        {/if}
        <div class="user-info">
          <div class="name">{displayName}</div>
          {#if ctx.username}
            <div class="username">@{ctx.username}</div>
          {/if}
        </div>
      </div>
    {/if}
  </Card>

  <Card title="Identifiers">
    {#if loading}
      <p class="text">Loading…</p>
    {:else if !ctx || !ctx.sphereUserId}
      <p class="text">—</p>
    {:else}
      <ul class="list">
        <li>
          <span class="label">sphere_user_id</span>
          <code title={ctx.sphereUserId}>{shortId(ctx.sphereUserId)}</code>
        </li>
        <li>
          <span class="label">username</span>
          <code>{ctx.username ?? '—'}</code>
        </li>
      </ul>
      <p class="hint">
        <code>sphere_user_id</code> is a per-app pseudonymous identifier.
        It is different for every mini app and stable for the
        (user, app) pair — reinstalls and device changes do not affect
        it. Use it to authenticate the user in your own backend.
      </p>
    {/if}
  </Card>

  <Card title="Built with">
    <ul class="list">
      <li>Svelte 5 — UI and reactivity</li>
      <li>TypeScript — typed props and data</li>
      <li>Vite — fast dev server and bundling</li>
    </ul>
  </Card>

  <Card title="Where to go next">
    <p class="text">
      Open <code>README.md</code> for the workflow, and
      <code>AI.md</code> for the architecture. Both are written for
      humans and language models alike.
    </p>
  </Card>
</section>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .head {
    padding: 8px 4px 4px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  h1 {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: #fff;
  }

  .head p {
    font-size: 14px;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.55);
  }

  .user {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .avatar--fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.85);
    font-size: 22px;
    font-weight: 700;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
  }

  .username {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.50);
  }

  .list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.72);
    min-width: 0;
  }

  .label {
    color: rgba(255, 255, 255, 0.45);
    font-size: 12px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .hint {
    margin-top: 10px;
    font-size: 12px;
    line-height: 1.55;
    color: rgba(255, 255, 255, 0.40);
  }

  .text {
    color: rgba(255, 255, 255, 0.55);
    font-size: 14px;
    line-height: 1.6;
  }
</style>