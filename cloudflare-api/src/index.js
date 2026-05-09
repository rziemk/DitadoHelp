/**
 * Scribeflowai API
 *
 * v1 scope:
 * - magic link auth
 * - session/device tracking
 * - conversation sync
 * - update metadata for non-store builds
 *
 * Apple App Store purchases are not implemented here yet.
 */

export default {
  async fetch(request, env, ctx) {
    try {
      return await router(request, env, ctx);
    } catch (error) {
      return json(
        {
          error: error?.message || 'internal_error',
          message: error instanceof Error ? error.message : 'Unexpected error',
        },
        Number(error?.status) || 500,
      );
    }
  },
};

async function router(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }

  if (pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, app: env.APP_NAME || 'Scribeflowai', now: nowIso() });
  }

  if (pathname === '/auth/request-magic-link' && request.method === 'POST') {
    const body = await request.json();
    return await handleMagicLinkRequest(body, env);
  }

  if (pathname === '/auth/request-status' && request.method === 'GET') {
    const requestId = url.searchParams.get('request_id') || '';
    return await handleAuthRequestStatus(requestId, env);
  }

  if (pathname === '/auth/login-password' && request.method === 'POST') {
    const body = await request.json();
    return await handlePasswordLogin(body, env);
  }

  if (pathname === '/auth/verify' && request.method === 'POST') {
    const body = await request.json();
    return await handleMagicLinkVerify(body, env);
  }

  if (pathname === '/auth/set-password' && request.method === 'POST') {
    const session = await requireSession(request, env);
    const body = await request.json();
    return await handleSetPassword(body, env, session.user.id);
  }

  if (pathname === '/auth/verify' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    const result = await handleMagicLinkVerify({ token }, env, true);
    return withCors(
      new Response(buildVerificationHtml(result), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
  }

  if (pathname === '/me' && request.method === 'GET') {
    const session = await requireSession(request, env);
    return json({ user: session.user, session: session.session, device: session.device });
  }

  if (pathname === '/me/settings' && request.method === 'GET') {
    const session = await requireSession(request, env);
    return await handleSettingsGet(env, session.user.id);
  }

  if (pathname === '/me/settings' && request.method === 'PUT') {
    const session = await requireSession(request, env);
    const body = await request.json();
    return await handleSettingsPut(env, session.user.id, body);
  }

  if (pathname === '/devices/heartbeat' && request.method === 'POST') {
    const session = await requireSession(request, env);
    const body = await request.json().catch(() => ({}));
    await updateDeviceHeartbeat(env, session.device.id, body);
    return json({ ok: true });
  }

  if (pathname === '/sync/conversations' && request.method === 'GET') {
    const session = await requireSession(request, env);
    const since = url.searchParams.get('since');
    return await handleConversationPull(env, session.user.id, since);
  }

  if (pathname === '/sync/conversations' && request.method === 'POST') {
    const session = await requireSession(request, env);
    const body = await request.json();
    return await handleConversationPush(env, session.user.id, session.device.id, body);
  }

  if (pathname === '/sync/call-comparisons' && request.method === 'GET') {
    const session = await requireSession(request, env);
    return await handleCallComparisonsPull(env, session.user.id);
  }

  if (pathname === '/sync/call-comparisons' && request.method === 'POST') {
    const session = await requireSession(request, env);
    const body = await request.json();
    return await handleCallComparisonsPush(env, session.user.id, body);
  }

  if (pathname === '/updates/latest' && request.method === 'GET') {
    const channel = url.searchParams.get('channel') || 'stable';
    const update = await env.DB.prepare(
      `SELECT channel, latest_version, minimum_supported_version, download_url, notes, published_at
       FROM app_updates
       WHERE channel = ?1`,
    ).bind(channel).first();
    return json({ update: update || null });
  }

  if (pathname === '/admin/online-users' && request.method === 'GET') {
    requireAdmin(request, env);
    const minutes = Number(url.searchParams.get('minutes') || '30');
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const rows = await env.DB.prepare(
      `SELECT
         d.id,
         d.name,
         d.platform,
         d.app_version,
         d.last_seen_at,
         u.id as user_id,
         u.email,
         u.plan
       FROM devices d
       INNER JOIN users u ON u.id = d.user_id
       WHERE d.last_seen_at >= ?1
       ORDER BY d.last_seen_at DESC`,
    ).bind(cutoff).all();
    return json({ items: rows.results || [], cutoff, minutes });
  }

  if (pathname === '/admin/app-updates' && request.method === 'POST') {
    requireAdmin(request, env);
    const body = await request.json();
    return await handleAppUpdateUpsert(env, body);
  }

  return json({ error: 'not_found' }, 404);
}

async function handleMagicLinkRequest(body, env) {
  const email = normalizeEmail(body?.email);
  if (!email) {
    return json({ error: 'invalid_email' }, 400);
  }

  const redirectUri = typeof body?.redirect_uri === 'string' && body.redirect_uri ? body.redirect_uri : '';
  const deviceName = trimString(body?.device_name);
  const displayName = trimString(body?.display_name);
  const phone = trimString(body?.phone);
  const uiLanguage = normalizeLanguage(body?.ui_language);
  if (!displayName) {
    return json({ error: 'missing_display_name' }, 400);
  }
  const user = await findOrCreateUser(env, { email, displayName, phone, uiLanguage });

  const token = randomToken();
  const tokenHash = await sha256(token);
  const createdAt = nowIso();
  const expiresAt = addMinutes(createdAt, Number(env.MAGIC_LINK_TTL_MINUTES || '20'));
  const linkId = crypto.randomUUID();
  const authRequestId = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO auth_requests (id, user_id, email, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(authRequestId, user.id, email, createdAt, expiresAt).run();

  await env.DB.prepare(
    `INSERT INTO magic_links (id, user_id, email, token_hash, device_name, redirect_uri, expires_at, created_at, auth_request_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(linkId, user.id, email, tokenHash, deviceName, redirectUri, expiresAt, createdAt, authRequestId).run();

  const verifyUrl = `${env.API_BASE_URL}/auth/verify?token=${encodeURIComponent(token)}`;
  const appUrl = env.APP_URL || '';
  const destinationUrl = redirectUri || appUrl;
  const finalLink = destinationUrl
    ? `${destinationUrl}?magic_link=${encodeURIComponent(token)}`
    : verifyUrl;

  const delivery = await sendMagicLinkEmail(env, {
    email,
    magicLink: finalLink,
    verifyUrl,
    appName: env.APP_NAME || 'Scribeflowai',
  });

  const response = {
    ok: true,
    email,
    request_id: authRequestId,
    expires_at: expiresAt,
    delivery,
  };

  if (env.DEBUG_MAGIC_LINKS === '1') {
    response.debug = { token, magic_link: finalLink, verify_url: verifyUrl };
  }

  return json(response);
}

async function handleAuthRequestStatus(requestId, env) {
  if (!requestId) {
    return json({ error: 'missing_request_id' }, 400);
  }
  const row = await env.DB.prepare(
    `SELECT ar.id, ar.status, ar.session_token, ar.session_expires_at, ar.expires_at,
            u.id as user_id, u.email, u.display_name, u.phone, u.ui_language, u.plan, u.app_store_status,
            u.email_verified_at, u.password_hash
     FROM auth_requests ar
     INNER JOIN users u ON u.id = ar.user_id
     WHERE ar.id = ?1`,
  ).bind(requestId).first();

  if (!row) {
    return json({ error: 'request_not_found' }, 404);
  }
  if (new Date(row.expires_at).getTime() < Date.now() && row.status === 'pending') {
    await env.DB.prepare(`UPDATE auth_requests SET status = 'expired' WHERE id = ?1`).bind(requestId).run();
    return json({ status: 'expired' });
  }
  if (row.status !== 'completed') {
    return json({ status: row.status });
  }

  await env.DB.prepare(
    `UPDATE auth_requests
     SET status = 'delivered', session_token = NULL
     WHERE id = ?1`,
  ).bind(requestId).run();

  return json({
    status: 'completed',
    session_token: row.session_token,
    session_expires_at: row.session_expires_at,
    user: serializeUser({
      id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      phone: row.phone,
      ui_language: row.ui_language,
      plan: row.plan,
      app_store_status: row.app_store_status,
      email_verified_at: row.email_verified_at,
      password_hash: row.password_hash,
    }),
  });
}

async function handleMagicLinkVerify(body, env, browserMode = false) {
  const token = trimString(body?.token);
  const deviceName = trimString(body?.device_name);
  const platform = trimString(body?.platform);
  const appVersion = trimString(body?.app_version);
  if (!token) {
    return json({ error: 'missing_token' }, 400);
  }

  const tokenHash = await sha256(token);
  const magicLink = await env.DB.prepare(
    `SELECT id, user_id, email, device_name, redirect_uri, expires_at, consumed_at, auth_request_id
     FROM magic_links
     WHERE token_hash = ?1`,
  ).bind(tokenHash).first();

  if (!magicLink) {
    return json({ error: 'invalid_token' }, 400);
  }
  if (magicLink.consumed_at) {
    return json({ error: 'token_already_used' }, 400);
  }
  if (new Date(magicLink.expires_at).getTime() < Date.now()) {
    return json({ error: 'token_expired' }, 400);
  }

  const now = nowIso();
  const auth = await createSessionForUser(env, {
    userId: magicLink.user_id,
    deviceName: deviceName || magicLink.device_name,
    platform,
    appVersion,
  });

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE magic_links SET consumed_at = ?1 WHERE id = ?2`,
    ).bind(now, magicLink.id),
    env.DB.prepare(
      `UPDATE users SET updated_at = ?1, last_login_at = ?1, email_verified_at = COALESCE(email_verified_at, ?1) WHERE id = ?2`,
    ).bind(now, magicLink.user_id),
    env.DB.prepare(
      `UPDATE auth_requests
       SET status = 'completed', session_token = ?1, session_expires_at = ?2, completed_at = ?3
       WHERE id = ?4`,
    ).bind(auth.session_token, auth.session_expires_at, now, magicLink.auth_request_id),
  ]);

  const user = await env.DB.prepare(
    `SELECT id, email, display_name, phone, ui_language, plan, app_store_status, created_at, updated_at, last_login_at,
            email_verified_at, password_hash
     FROM users WHERE id = ?1`,
  ).bind(magicLink.user_id).first();

  const payload = {
    ok: true,
    session_token: auth.session_token,
    session_expires_at: auth.session_expires_at,
    user: serializeUser(user),
    device: {
      id: auth.device.id,
      name: auth.device.name,
      platform: auth.device.platform,
      app_version: auth.device.app_version,
    },
  };

  if (browserMode) {
    return payload;
  }

  return json(payload);
}

async function handlePasswordLogin(body, env) {
  const email = normalizeEmail(body?.email);
  const password = trimString(body?.password);
  const deviceName = trimString(body?.device_name);
  const platform = trimString(body?.platform);
  const appVersion = trimString(body?.app_version);
  if (!email || !password) {
    return json({ error: 'missing_credentials' }, 400);
  }

  const user = await env.DB.prepare(
    `SELECT id, email, display_name, phone, ui_language, plan, app_store_status, created_at, updated_at, last_login_at,
            email_verified_at, password_hash, password_salt
     FROM users WHERE email = ?1`,
  ).bind(email).first();

  if (!user || !user.password_hash || !user.password_salt) {
    return json({ error: 'password_not_configured' }, 400);
  }
  if (!user.email_verified_at) {
    return json({ error: 'email_not_verified' }, 403);
  }

  const passwordHash = await hashPassword(password, user.password_salt);
  if (passwordHash !== user.password_hash) {
    return json({ error: 'invalid_credentials' }, 401);
  }

  const auth = await createSessionForUser(env, {
    userId: user.id,
    deviceName: deviceName || 'Scribeflowai Desktop',
    platform,
    appVersion,
  });

  return json({
    ok: true,
    session_token: auth.session_token,
    session_expires_at: auth.session_expires_at,
    user: serializeUser(user),
    device: auth.device,
  });
}

async function handleSetPassword(body, env, userId) {
  const password = trimString(body?.password);
  const confirmPassword = trimString(body?.confirm_password);
  if (password.length < 6) {
    return json({ error: 'password_too_short', message: 'password_too_short' }, 400);
  }
  if (password !== confirmPassword) {
    return json({ error: 'password_mismatch', message: 'password_mismatch' }, 400);
  }

  const salt = randomToken();
  const passwordHash = await hashPassword(password, salt);
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE users
     SET password_hash = ?1, password_salt = ?2, updated_at = ?3, email_verified_at = COALESCE(email_verified_at, ?3)
     WHERE id = ?4`,
  ).bind(passwordHash, salt, now, userId).run();

  return json({ ok: true, password_configured: true, updated_at: now });
}

async function handleConversationPull(env, userId, since) {
  const rows = since
    ? await env.DB.prepare(
      `SELECT id, action, source_text, final_text, created_at, updated_at, deleted_at, sync_version, device_id
       FROM conversations
       WHERE user_id = ?1 AND updated_at > ?2
       ORDER BY updated_at DESC
       LIMIT 500`,
    ).bind(userId, since).all()
    : await env.DB.prepare(
      `SELECT id, action, source_text, final_text, created_at, updated_at, deleted_at, sync_version, device_id
       FROM conversations
       WHERE user_id = ?1
       ORDER BY updated_at DESC
       LIMIT 500`,
    ).bind(userId).all();
  return json({ items: rows.results || [] });
}

async function handleConversationPush(env, userId, deviceId, body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const now = nowIso();
  for (const item of items) {
    const id = trimString(item?.id) || crypto.randomUUID();
    const action = trimString(item?.action) || 'dictate';
    const sourceText = trimString(item?.source_text);
    const finalText = trimString(item?.final_text);
    const createdAt = trimString(item?.created_at) || now;
    const updatedAt = trimString(item?.updated_at) || now;
    const deletedAt = trimString(item?.deleted_at);
    if (!finalText && !deletedAt) continue;

    await env.DB.prepare(
      `INSERT INTO conversations (id, user_id, device_id, action, source_text, final_text, created_at, updated_at, deleted_at, sync_version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1)
       ON CONFLICT(id) DO UPDATE SET
         action = excluded.action,
         source_text = excluded.source_text,
         final_text = excluded.final_text,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at,
         sync_version = conversations.sync_version + 1`,
    ).bind(id, userId, deviceId, action, sourceText, finalText || '', createdAt, updatedAt, deletedAt).run();
  }

  return json({ ok: true, received: items.length });
}

async function handleCallComparisonsPull(env, userId) {
  const scriptsRows = await env.DB.prepare(
    `SELECT id, name, body, created_at, updated_at, deleted_at
     FROM call_comparison_scripts
     WHERE user_id = ?1 AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
  ).bind(userId).all();

  const groupRows = await env.DB.prepare(
    `SELECT id, script_id, name, source_type, source_path, source_loaded_at, summary,
            average_score, good_count, bad_count, analyzed_count, total_count, created_at, updated_at, deleted_at
     FROM call_comparison_groups
     WHERE user_id = ?1 AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
  ).bind(userId).all();

  const recordingRows = await env.DB.prepare(
    `SELECT id, group_id, file_name, file_path, status, is_transcribed, raw_transcript, speaker_transcript,
            transcript_summary, analysis, comparison_summary, score, is_good, error, transcribed_at, analyzed_at,
            created_at, updated_at, deleted_at
     FROM call_recordings
     WHERE user_id = ?1 AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
  ).bind(userId).all();

  const callsByGroup = new Map();
  for (const row of recordingRows.results || []) {
    if (!callsByGroup.has(row.group_id)) callsByGroup.set(row.group_id, []);
    callsByGroup.get(row.group_id).push({
      ...row,
      is_transcribed: Boolean(row.is_transcribed),
      is_good: row.is_good == null ? null : Boolean(row.is_good),
    });
  }

  return json({
    scripts: scriptsRows.results || [],
    groups: (groupRows.results || []).map((group) => ({
      ...group,
      calls: callsByGroup.get(group.id) || [],
    })),
  });
}

async function handleCallComparisonsPush(env, userId, body) {
  const scripts = Array.isArray(body?.scripts) ? body.scripts : [];
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  const now = nowIso();

  for (const script of scripts) {
    const id = trimString(script?.id) || crypto.randomUUID();
    const name = trimString(script?.name) || 'Script sem nome';
    const scriptBody = trimString(script?.body);
    const createdAt = trimString(script?.created_at) || now;
    const updatedAt = trimString(script?.updated_at) || now;
    await env.DB.prepare(
      `INSERT INTO call_comparison_scripts (id, user_id, name, body, created_at, updated_at, deleted_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         body = excluded.body,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    ).bind(id, userId, name, scriptBody, createdAt, updatedAt).run();
  }

  for (const group of groups) {
    const id = trimString(group?.id) || crypto.randomUUID();
    const calls = Array.isArray(group?.calls) ? group.calls : [];
    const stats = callGroupStats(calls);
    const createdAt = trimString(group?.created_at) || now;
    const updatedAt = trimString(group?.updated_at) || now;
    await env.DB.prepare(
      `INSERT INTO call_comparison_groups (
         id, user_id, script_id, name, source_type, source_path, source_loaded_at, summary,
         average_score, good_count, bad_count, analyzed_count, total_count, created_at, updated_at, deleted_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, NULL)
       ON CONFLICT(id) DO UPDATE SET
         script_id = excluded.script_id,
         name = excluded.name,
         source_type = excluded.source_type,
         source_path = excluded.source_path,
         source_loaded_at = excluded.source_loaded_at,
         summary = excluded.summary,
         average_score = excluded.average_score,
         good_count = excluded.good_count,
         bad_count = excluded.bad_count,
         analyzed_count = excluded.analyzed_count,
         total_count = excluded.total_count,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    ).bind(
      id,
      userId,
      trimString(group?.script_id) || null,
      trimString(group?.name) || 'Grupo sem nome',
      trimString(group?.source_type),
      trimString(group?.source_path),
      trimString(group?.source_loaded_at),
      trimString(group?.summary),
      stats.averageScore,
      stats.goodCount,
      stats.badCount,
      stats.analyzedCount,
      stats.totalCount,
      createdAt,
      updatedAt,
    ).run();

    for (const call of calls) {
      const callId = trimString(call?.id) || crypto.randomUUID();
      const score = normalizeScore(call?.score);
      const isTranscribed = call?.is_transcribed || call?.raw_transcript || call?.speaker_transcript ? 1 : 0;
      const isGood = call?.is_good == null && score == null ? null : call?.is_good === false ? 0 : call?.is_good === true ? 1 : score >= 70 ? 1 : 0;
      const callCreatedAt = trimString(call?.created_at) || createdAt;
      const callUpdatedAt = trimString(call?.updated_at) || updatedAt;
      await env.DB.prepare(
        `INSERT INTO call_recordings (
           id, user_id, group_id, file_name, file_path, status, is_transcribed, raw_transcript, speaker_transcript,
           transcript_summary, analysis, comparison_summary, score, is_good, error, transcribed_at, analyzed_at,
           created_at, updated_at, deleted_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, NULL)
         ON CONFLICT(id) DO UPDATE SET
           group_id = excluded.group_id,
           file_name = excluded.file_name,
           file_path = excluded.file_path,
           status = excluded.status,
           is_transcribed = excluded.is_transcribed,
           raw_transcript = excluded.raw_transcript,
           speaker_transcript = excluded.speaker_transcript,
           transcript_summary = excluded.transcript_summary,
           analysis = excluded.analysis,
           comparison_summary = excluded.comparison_summary,
           score = excluded.score,
           is_good = excluded.is_good,
           error = excluded.error,
           transcribed_at = excluded.transcribed_at,
           analyzed_at = excluded.analyzed_at,
           updated_at = excluded.updated_at,
           deleted_at = NULL`,
      ).bind(
        callId,
        userId,
        id,
        trimString(call?.file_name) || 'audio',
        trimString(call?.file_path),
        trimString(call?.status) || 'Pendente',
        isTranscribed,
        trimString(call?.raw_transcript),
        trimString(call?.speaker_transcript),
        trimString(call?.transcript_summary),
        trimString(call?.analysis),
        trimString(call?.comparison_summary),
        score,
        isGood,
        trimString(call?.error),
        trimString(call?.transcribed_at),
        trimString(call?.analyzed_at),
        callCreatedAt,
        callUpdatedAt,
      ).run();
    }
  }

  return json({ ok: true, scripts: scripts.length, groups: groups.length });
}

function callGroupStats(calls) {
  const totalCount = calls.length;
  const analyzed = calls.filter((call) => trimString(call?.analysis) || call?.score != null);
  const scored = calls.map((call) => normalizeScore(call?.score)).filter((score) => score != null);
  const goodCount = scored.filter((score) => score >= 70).length;
  const badCount = scored.filter((score) => score < 70).length;
  const averageScore = scored.length ? Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length) : null;
  return { totalCount, analyzedCount: analyzed.length, goodCount, badCount, averageScore };
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function handleSettingsGet(env, userId) {
  const settings = await env.DB.prepare(
    `SELECT llm_provider, stt_model, llm_model, translation_lang, auto_sync_cloud, same_key, use_free_fallback, append_dictation, ui_language, updated_at
     FROM user_settings
     WHERE user_id = ?1`,
  ).bind(userId).first();
  const secrets = await env.DB.prepare(
    `SELECT stt_key_encrypted, llm_key_encrypted, updated_at
     FROM user_secrets
     WHERE user_id = ?1`,
  ).bind(userId).first();

  let sttKey = '';
  let llmKey = '';
  if (secrets?.stt_key_encrypted) {
    sttKey = await decryptSecret(env, secrets.stt_key_encrypted);
  }
  if (secrets?.llm_key_encrypted) {
    llmKey = await decryptSecret(env, secrets.llm_key_encrypted);
  }

  return json({
    settings: settings ? {
      llm_provider: settings.llm_provider,
      stt_model: settings.stt_model,
      llm_model: settings.llm_model,
      translation_lang: settings.translation_lang,
      auto_sync_cloud: Boolean(settings.auto_sync_cloud),
      same_key: Boolean(settings.same_key),
      use_free_fallback: Boolean(settings.use_free_fallback),
      append_dictation: Boolean(settings.append_dictation),
      ui_language: settings.ui_language,
      updated_at: settings.updated_at,
    } : null,
    secrets: {
      stt_key: sttKey,
      llm_key: llmKey,
      updated_at: secrets?.updated_at || null,
    },
  });
}

async function handleSettingsPut(env, userId, body) {
  const now = nowIso();
  const settings = body?.settings || {};
  const secrets = body?.secrets || {};
  const llmProvider = trimString(settings.llm_provider) || 'openai';
  const sttModel = trimString(settings.stt_model);
  const llmModel = trimString(settings.llm_model);
  const translationLang = normalizeLanguage(settings.translation_lang);
  const uiLanguage = normalizeLanguage(settings.ui_language);
  const autoSyncCloud = settings.auto_sync_cloud === false ? 0 : 1;
  const sameKey = settings.same_key ? 1 : 0;
  const useFreeFallback = settings.use_free_fallback ? 1 : 0;
  const appendDictation = settings.append_dictation ? 1 : 0;
  const sttKey = trimString(secrets.stt_key);
  const llmKey = trimString(secrets.llm_key);

  await env.DB.prepare(
    `INSERT INTO user_settings (
       user_id, llm_provider, stt_model, llm_model, translation_lang, auto_sync_cloud, same_key, use_free_fallback, append_dictation, ui_language, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(user_id) DO UPDATE SET
       llm_provider = excluded.llm_provider,
       stt_model = excluded.stt_model,
       llm_model = excluded.llm_model,
       translation_lang = excluded.translation_lang,
       auto_sync_cloud = excluded.auto_sync_cloud,
       same_key = excluded.same_key,
       use_free_fallback = excluded.use_free_fallback,
       append_dictation = excluded.append_dictation,
       ui_language = excluded.ui_language,
       updated_at = excluded.updated_at`,
  ).bind(userId, llmProvider, sttModel, llmModel, translationLang, autoSyncCloud, sameKey, useFreeFallback, appendDictation, uiLanguage, now).run();

  const sttEncrypted = sttKey ? await encryptSecret(env, sttKey) : null;
  const llmEncrypted = llmKey ? await encryptSecret(env, llmKey) : null;
  await env.DB.prepare(
    `INSERT INTO user_secrets (user_id, stt_key_encrypted, llm_key_encrypted, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id) DO UPDATE SET
       stt_key_encrypted = excluded.stt_key_encrypted,
       llm_key_encrypted = excluded.llm_key_encrypted,
       updated_at = excluded.updated_at`,
  ).bind(userId, sttEncrypted, llmEncrypted, now).run();

  return json({ ok: true, updated_at: now });
}

async function handleAppUpdateUpsert(env, body) {
  const channel = trimString(body?.channel) || 'stable';
  const latestVersion = trimString(body?.latest_version);
  if (!latestVersion) {
    return json({ error: 'missing_latest_version' }, 400);
  }
  const minimumSupportedVersion = trimString(body?.minimum_supported_version) || null;
  const downloadUrl = trimString(body?.download_url) || null;
  const notes = trimString(body?.notes) || null;
  const publishedAt = trimString(body?.published_at) || nowIso();

  await env.DB.prepare(
    `INSERT INTO app_updates (channel, latest_version, minimum_supported_version, download_url, notes, published_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(channel) DO UPDATE SET
       latest_version = excluded.latest_version,
       minimum_supported_version = excluded.minimum_supported_version,
       download_url = excluded.download_url,
       notes = excluded.notes,
       published_at = excluded.published_at`,
  ).bind(channel, latestVersion, minimumSupportedVersion, downloadUrl, notes, publishedAt).run();

  return json({ ok: true, channel, latest_version: latestVersion, published_at: publishedAt });
}

async function requireSession(request, env) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    throw httpError(401, 'missing_session');
  }

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT
       s.id as session_id,
       s.user_id as user_id,
       s.device_id as device_id,
       s.expires_at as session_expires_at,
       s.revoked_at as session_revoked_at,
       u.email as email,
       u.display_name as display_name,
       u.phone as phone,
       u.ui_language as ui_language,
       u.plan as plan,
       u.app_store_status as app_store_status,
       u.email_verified_at as email_verified_at,
       u.password_hash as password_hash,
       d.name as device_name,
       d.platform as device_platform,
       d.app_version as device_app_version
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN devices d ON d.id = s.device_id
     WHERE s.session_token_hash = ?1`,
  ).bind(tokenHash).first();

  if (!row || row.session_revoked_at) {
    throw httpError(401, 'invalid_session');
  }
  if (new Date(row.session_expires_at).getTime() < Date.now()) {
    throw httpError(401, 'session_expired');
  }

  const now = nowIso();
  await env.DB.prepare(`UPDATE sessions SET last_seen_at = ?1 WHERE id = ?2`).bind(now, row.session_id).run();
  if (row.device_id) {
    await env.DB.prepare(`UPDATE devices SET last_seen_at = ?1 WHERE id = ?2`).bind(now, row.device_id).run();
  }

  return {
    user: serializeUser({
      id: row.user_id,
      email: row.email,
      display_name: row.display_name,
      phone: row.phone,
      ui_language: row.ui_language,
      plan: row.plan,
      app_store_status: row.app_store_status,
      email_verified_at: row.email_verified_at,
      password_hash: row.password_hash,
    }),
    session: {
      id: row.session_id,
      expires_at: row.session_expires_at,
    },
    device: {
      id: row.device_id,
      name: row.device_name,
      platform: row.device_platform,
      app_version: row.device_app_version,
    },
  };
}

async function updateDeviceHeartbeat(env, deviceId, body) {
  if (!deviceId) return;
  await env.DB.prepare(
    `UPDATE devices SET last_seen_at = ?1, app_version = COALESCE(?2, app_version), platform = COALESCE(?3, platform)
     WHERE id = ?4`,
  ).bind(nowIso(), trimString(body?.app_version), trimString(body?.platform), deviceId).run();
}

async function findOrCreateUser(env, { email, displayName, phone, uiLanguage }) {
  const existing = await env.DB.prepare(
    `SELECT id, email, display_name, phone, ui_language, plan, app_store_status, created_at, updated_at, last_login_at,
            email_verified_at, password_hash, password_salt
     FROM users WHERE email = ?1`,
  ).bind(email).first();
  const now = nowIso();
  if (existing) {
    await env.DB.prepare(
      `UPDATE users
       SET display_name = COALESCE(NULLIF(?1, ''), display_name),
           phone = CASE WHEN ?2 <> '' THEN ?2 ELSE phone END,
           ui_language = COALESCE(NULLIF(?3, ''), ui_language),
           updated_at = ?4
       WHERE id = ?5`,
    ).bind(displayName, phone, uiLanguage, now, existing.id).run();
    return {
      ...existing,
      display_name: displayName || existing.display_name,
      phone: phone || existing.phone,
      ui_language: uiLanguage || existing.ui_language,
      updated_at: now,
    };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, phone, ui_language, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(id, email, displayName || null, phone || null, uiLanguage, now, now).run();
  return {
    id,
    email,
    display_name: displayName || null,
    phone: phone || null,
    ui_language: uiLanguage,
    plan: 'free',
    app_store_status: 'inactive',
    created_at: now,
    updated_at: now,
    last_login_at: null,
    email_verified_at: null,
    password_hash: null,
    password_salt: null,
  };
}

async function createSessionForUser(env, { userId, deviceName, platform, appVersion }) {
  const sessionToken = randomToken();
  const sessionTokenHash = await sha256(sessionToken);
  const now = nowIso();
  const deviceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const sessionExpiresAt = addDays(now, 30);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO devices (id, user_id, name, platform, app_version, last_seen_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(deviceId, userId, deviceName || 'Scribeflowai Desktop', platform || 'desktop', appVersion || null, now, now),
    env.DB.prepare(
      `INSERT INTO sessions (id, user_id, session_token_hash, device_id, expires_at, created_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(sessionId, userId, sessionTokenHash, deviceId, sessionExpiresAt, now, now),
    env.DB.prepare(
      `UPDATE users SET updated_at = ?1, last_login_at = ?1 WHERE id = ?2`,
    ).bind(now, userId),
  ]);

  return {
    session_token: sessionToken,
    session_expires_at: sessionExpiresAt,
    device: {
      id: deviceId,
      name: deviceName || 'Scribeflowai Desktop',
      platform: platform || 'desktop',
      app_version: appVersion || null,
    },
  };
}

function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    phone: user.phone,
    ui_language: user.ui_language,
    plan: user.plan,
    app_store_status: user.app_store_status,
    email_verified_at: user.email_verified_at || null,
    has_password: Boolean(user.password_hash),
  };
}

async function sendMagicLinkEmail(env, { email, magicLink, verifyUrl, appName }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    return { provider: 'debug', status: 'not_configured', verify_url: verifyUrl };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: `Seu link de acesso ao ${appName}`,
      html: `<p>Use este link para entrar no ${escapeHtml(appName)}:</p><p><a href="${magicLink}">${magicLink}</a></p><p>Se voce nao solicitou este acesso, ignore este email.</p>`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send email: ${text}`);
  }

  return { provider: 'resend', status: 'sent' };
}

async function encryptSecret(env, plaintext) {
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

async function decryptSecret(env, payload) {
  const [ivPart, dataPart] = String(payload).split('.');
  if (!ivPart || !dataPart) return '';
  const key = await getEncryptionKey(env);
  const iv = base64ToBytes(ivPart);
  const ciphertext = base64ToBytes(dataPart);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

let encryptionKeyPromise;
async function getEncryptionKey(env) {
  if (!env.SETTINGS_ENCRYPTION_KEY) {
    throw new Error('missing_settings_encryption_key');
  }
  if (!encryptionKeyPromise) {
    const raw = hexToBytes(env.SETTINGS_ENCRYPTION_KEY);
    encryptionKeyPromise = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  return encryptionKeyPromise;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value) {
  const email = trimString(value).toLowerCase();
  if (!email || !email.includes('@')) return '';
  return email;
}

function normalizeLanguage(value) {
  const lang = trimString(value).toLowerCase();
  return ['pt', 'en', 'fr', 'es', 'de'].includes(lang) ? lang : 'pt';
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(iso, minutes) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function addDays(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(input) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  let value = `${salt}:${password}`;
  for (let i = 0; i < 120000; i += 1) {
    value = await sha256(value);
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToBytes(value) {
  const normalized = String(value).trim();
  if (normalized.length % 2 !== 0) {
    throw new Error('invalid_hex_key');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

function json(payload, status = 200) {
  return withCors(
    new Response(JSON.stringify(payload, null, 2), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
    }),
  );
}

function withCors(response) {
  response.headers.set('access-control-allow-origin', '*');
  response.headers.set('access-control-allow-headers', 'authorization, content-type');
  response.headers.set('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
  return response;
}

function httpError(status, code) {
  const error = new Error(code);
  error.status = status;
  throw error;
}

function requireAdmin(request, env) {
  const adminKey = request.headers.get('x-admin-key') || '';
  if (!env.ADMIN_API_KEY || adminKey !== env.ADMIN_API_KEY) {
    throw httpError(401, 'admin_unauthorized');
  }
}

function buildVerificationHtml(payload) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scribeflowai login</title>
    <style>
      body { font-family: sans-serif; padding: 32px; background: #f7fafc; color: #0f172a; }
      .card { max-width: 680px; margin: 0 auto; background: white; border: 1px solid #dbe4f1; border-radius: 16px; padding: 24px; }
      code { display: block; padding: 12px; background: #eff6ff; border-radius: 12px; overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Login confirmado</h1>
      <p>O login foi confirmado. Volte ao app Scribeflowai. A sessao sera detectada automaticamente.</p>
    </div>
  </body>
</html>`;
}
