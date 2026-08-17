/* Gera o SENHA_HASH para o servidor.
 *
 *   node servidor/senha.js "a senha que você escolher"
 *
 * A senha em si não é guardada em lugar nenhum — só o hash, que não permite
 * voltar à senha original. Guarde o hash como secret e a senha com você.
 */

import { hashSenha } from "./api.js";

const senha = process.argv.slice(2).join(" ");
if (!senha) {
  console.error('Uso: node servidor/senha.js "sua senha"');
  process.exit(1);
}
if (senha.length < 8) {
  console.error("Escolha uma senha com pelo menos 8 caracteres.");
  process.exit(1);
}

const hash = await hashSenha(senha);
const segredo = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((b) => b.toString(16).padStart(2, "0")).join("");

console.log("SENHA_HASH");
console.log(hash);
console.log();
console.log("SESSAO_SEGREDO");
console.log(segredo);
