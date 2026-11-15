// =====================================================================
// ENGLISH START PRO – Edge Function "account"
//   action "register": tạo tài khoản học viên + gửi MẬT KHẨU TẠM qua Gmail
//   action "reset":    cấp lại mật khẩu tạm (quên mật khẩu)
// Bí mật cần đặt trong Supabase → Edge Functions → Secrets:
//   GMAIL_USER          = buildhr.hotro@gmail.com
//   GMAIL_APP_PASSWORD  = (16 ký tự "Mật khẩu ứng dụng" của Google – anh tự dán)
//   APP_URL             = https://lehoangan-dot.github.io/english-start-pro/
// (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY có sẵn trong môi trường Edge Function)
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const APP_URL = Deno.env.get("APP_URL") ?? "https://lehoangan-dot.github.io/english-start-pro/";

function tempPassword(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ", a = "abcdefghjkmnpqrstuvwxyz", d = "23456789";
  const all = A + a + d, r = new Uint32Array(10);
  crypto.getRandomValues(r);
  const chars = Array.from(r, (n) => all[n % all.length]);
  chars[2] = A[r[2] % A.length]; chars[5] = d[r[5] % d.length]; chars[8] = a[r[8] % a.length];
  return chars.join("");
}
async function sha(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Gửi email qua Gmail SMTP (tự viết, mã hóa UTF-8 chuẩn để tiếng Việt hiển thị đúng) ----
const enc = new TextEncoder(), dec = new TextDecoder();
function b64(s: string) {
  const bytes = enc.encode(s); let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function sendMail(to: string, subject: string, text: string) {
  const user = Deno.env.get("GMAIL_USER")!, pass = (Deno.env.get("GMAIL_APP_PASSWORD") ?? "").replace(/\s+/g, "");
  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });
  let buf = "";
  const reply = async () => {
    const chunk = new Uint8Array(4096);
    while (true) {
      const lines = buf.split("\r\n");
      const last = lines[lines.length - 2] ?? "";
      if (buf.endsWith("\r\n") && /^\d{3} /.test(last)) { const code = +last.slice(0, 3); const r = buf; buf = ""; return { code, r }; }
      const n = await conn.read(chunk);
      if (n === null) throw new Error("SMTP connection closed");
      buf += dec.decode(chunk.subarray(0, n));
    }
  };
  const cmd = async (c: string, expect: number) => {
    await conn.write(enc.encode(c + "\r\n"));
    const { code, r } = await reply();
    if (code !== expect) throw new Error(`SMTP ${c.split(" ")[0]} -> ${r.trim()}`);
  };
  try {
    const hello = await reply(); if (hello.code !== 220) throw new Error("SMTP greeting " + hello.r);
    await cmd("EHLO english-start-pro", 250);
    await cmd("AUTH LOGIN", 334); await cmd(b64(user), 334); await cmd(b64(pass), 235);
    await cmd(`MAIL FROM:<${user}>`, 250); await cmd(`RCPT TO:<${to}>`, 250); await cmd("DATA", 354);
    const body = (b64(text).match(/.{1,76}/g) ?? []).join("\r\n");
    const msg = [
      `From: =?UTF-8?B?${b64("English Start Pro")}?= <${user}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@english-start-pro>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "", body,
    ].join("\r\n");
    await conn.write(enc.encode(msg + "\r\n.\r\n"));
    const sent = await reply(); if (sent.code !== 250) throw new Error("SMTP send " + sent.r);
    try { await cmd("QUIT", 221); } catch (_e) { /* bỏ qua */ }
  } finally { try { conn.close(); } catch (_e) { /* đã đóng */ } }
}
function mailBody(email: string, pwd: string, isReset: boolean) {
  const subject = isReset ? "English Start Pro - Mật khẩu tạm thời mới" : "English Start Pro - Thông tin đăng nhập";
  const text = [
    isReset ? "Bạn vừa yêu cầu cấp lại mật khẩu." : "Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi.",
    "",
    `Tài khoản đăng nhập của bạn là: ${email}`,
    `Mật khẩu truy cập tạm thời là: ${pwd}`,
    "",
    "Bạn vui lòng đổi lại mật khẩu trước khi sử dụng để đảm bảo tính an toàn.",
    "",
    `Đăng nhập tại: ${APP_URL}`,
    "",
    "English Start Pro",
  ].join("\r\n");
  return { subject, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Phương thức không hợp lệ." }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ error: "Dữ liệu không hợp lệ." }, 400); }

  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return json({ error: "Email không hợp lệ." }, 400);

  // ---------- ĐĂNG KÝ ----------
  if (b.action === "register") {
    if (b.website) return json({ ok: true }); // bẫy bot (ô ẩn)
    const full_name = String(b.full_name ?? "").trim().replace(/\s+/g, " ");
    const phone = String(b.phone ?? "").replace(/[\s.\-()]/g, "");
    const address = String(b.address ?? "").trim().replace(/\s+/g, " ");
    if (full_name.length < 2 || full_name.length > 80) return json({ error: "Vui lòng nhập họ tên (2–80 ký tự)." }, 400);
    if (!/^(\+?84|0)\d{9,10}$/.test(phone)) return json({ error: "Số điện thoại không hợp lệ (vd. 0912345678)." }, 400);
    if (address.length < 5 || address.length > 200) return json({ error: "Vui lòng nhập địa chỉ (ít nhất 5 ký tự)." }, 400);
    if (b.consent !== true) return json({ error: "Bạn cần đồng ý với điều khoản xử lý dữ liệu cá nhân." }, 400);

    // chống spam: tối đa 5 lần đăng ký / giờ / địa chỉ IP
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const ip_hash = await sha(ip + "|esp");
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("register_log").select("id", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Bạn đăng ký quá nhiều lần. Vui lòng thử lại sau 1 giờ." }, 429);
    await admin.from("register_log").insert({ ip_hash });

    const { data: exist } = await admin.from("students").select("user_id").eq("email", email).maybeSingle();
    if (exist) return json({ error: "Email này đã được đăng ký. Hãy đăng nhập hoặc dùng “Quên mật khẩu”." }, 409);

    const pwd = tempPassword();
    const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, password: pwd, email_confirm: true, user_metadata: { full_name } });
    if (e1 || !created?.user) {
      const dup = /already|registered|exists/i.test(e1?.message ?? "");
      return json({ error: dup ? "Email này đã được đăng ký. Hãy đăng nhập hoặc dùng “Quên mật khẩu”." : "Không tạo được tài khoản, vui lòng thử lại." }, dup ? 409 : 500);
    }
    const uid = created.user.id;
    const { error: e2 } = await admin.from("students").insert({ user_id: uid, full_name, email, phone, address, must_change_password: true });
    if (e2) { await admin.auth.admin.deleteUser(uid); return json({ error: "Không lưu được hồ sơ, vui lòng thử lại." }, 500); }

    try {
      const m = mailBody(email, pwd, false);
      await sendMail(email, m.subject, m.text);
    } catch (_e) {
      await admin.auth.admin.deleteUser(uid); // xóa luôn hồ sơ nhờ ON DELETE CASCADE
      return json({ error: "Không gửi được email. Vui lòng kiểm tra lại địa chỉ email hoặc thử lại sau." }, 502);
    }
    return json({ ok: true });
  }

  // ---------- QUÊN MẬT KHẨU ----------
  if (b.action === "reset") {
    const generic = { ok: true, message: "Nếu email đã đăng ký, mật khẩu tạm thời mới đã được gửi tới hộp thư." };
    const { data: st } = await admin.from("students").select("user_id, full_name, last_reset_at").eq("email", email).maybeSingle();
    if (!st) return json(generic);
    if (st.last_reset_at && Date.now() - new Date(st.last_reset_at).getTime() < 3 * 60_000)
      return json({ error: "Vừa gửi mật khẩu mới. Vui lòng đợi 3 phút rồi thử lại." }, 429);
    const pwd = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(st.user_id, { password: pwd });
    if (error) return json({ error: "Không cấp lại được mật khẩu, thử lại sau." }, 500);
    await admin.from("students").update({ must_change_password: true, last_reset_at: new Date().toISOString() }).eq("user_id", st.user_id);
    try { const m = mailBody(email, pwd, true); await sendMail(email, m.subject, m.text); }
    catch (_e) { return json({ error: "Không gửi được email, thử lại sau." }, 502); }
    return json(generic);
  }

  return json({ error: "Thao tác không hợp lệ." }, 400);
});
