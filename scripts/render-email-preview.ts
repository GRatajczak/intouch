import { writeFileSync } from "node:fs";
import { renderEmailShell } from "../src/lib/email/shell";

const html = renderEmailShell({
  subject: "InTouch — sprawdzenie ścieżki dostarczania",
  bodyHtml: `<p>To jest testowa wiadomość potwierdzająca, że Worker InTouch potrafi wysłać e-mail z zaplanowanego triggera.</p><p style="color: #A39A90; font-size: 13px;">Podgląd lokalny — bez rzeczywistego wywołania crona.</p>`,
});

writeFileSync("email-preview.html", html);
console.log("Written to email-preview.html");
