interface RenderEmailShellOptions {
  subject: string;
  bodyHtml: string;
}

// Chrome only, styled from InTouch.dc.html:1080-1087,1141-1144 — bodyHtml carries no ranking data.
export function renderEmailShell({ subject, bodyHtml }: RenderEmailShellOptions): string {
  const date = new Date().toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin: 0; padding: 20px; background: #EFE9E1; font-family: 'Plus Jakarta Sans', system-ui, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background: #FBF8F4; border-radius: 20px; overflow: hidden;">
      <div style="padding: 28px 40px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #EAE3D9;">
        <div style="display: inline-flex; align-items: center;">
          <span style="display: inline-block; width: 26px; height: 26px; border-radius: 50%; background: #F3C7CD;"></span>
          <span style="display: inline-block; width: 26px; height: 26px; border-radius: 50%; background: #C6CDEE; margin-left: -10px;"></span>
        </div>
        <div style="font-family: 'Instrument Serif', serif; font-size: 24px; color: #2A2724;">InTouch</div>
        <div style="margin-left: auto; font-size: 12px; color: #A39A90;">${date}</div>
      </div>
      <div style="padding: 34px 40px 30px; color: #55504A; font-size: 16px; line-height: 1.65;">
        ${bodyHtml}
      </div>
      <div style="margin: 8px 0 0; background: #F3EDE5; padding: 24px 40px 30px; display: flex; flex-direction: column; gap: 8px;">
        <div style="font-size: 13px; line-height: 1.6; color: #6B645C;">To jest testowa wiadomość ze ścieżki dostarczania InTouch — nie zawiera jeszcze prawdziwych przypomnień.</div>
        <div style="font-size: 13px; color: #8B837A;">InTouch</div>
      </div>
    </div>
  </body>
</html>`;
}
