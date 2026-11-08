import * as db from './db.js';
import {
  STATUS,
  cabecalho,
  dataCurta,
  dadosProximaAcao,
  descricaoPeca,
  formatarOf,
  legendaFoto,
  linhaItem,
  montarRelatorio,
  nomeArquivoFoto,
  proximaAcao,
  rotuloEtapa,
  semAcento,
  textoOf,
  textoStatus,
} from './relatorio.js';
import { carimbarFoto, processarFoto } from './fotos.js';
import { icone } from './icones.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const dock = $('dock');
const dockAcao = $('dock-acao');
const elNav = $('nav');
const elToast = $('toast');
const dialogo = $('dialogo');
const inputCamera = $('foto-camera');
const inputGaleria = $('foto-galeria');

// Limite prudente por compartilhamento. Se o celular aceitar mais, basta aumentar aqui.
const FOTOS_POR_ENVIO = 10;
const HORAS_PARA_AVISAR_TURNO = 16;
const CHAVE_RASCUNHO = 'inspecao-lp:rascunho';
const MINIATURAS_NO_CARD = 4;
const NOME_APP = 'Inspeção LP';

const ABAS = [
  { id: 'turno', href: '#/', nome: 'Turno', icone: 'turno' },
  { id: 'relatorio', href: '#/relatorio', nome: 'Relatório', icone: 'relatorio' },
  { id: 'historico', href: '#/historico', nome: 'Histórico', icone: 'historico' },
];

const MENSAGEM_FOTO = 'Não foi possível ler esta foto. Tire de novo ou escolha outra.';
const MENSAGEM_ESPACO = 'Sem espaço para guardar a foto. Exclua turnos antigos em Histórico e tente de novo.';

const regrasPlural = new Intl.PluralRules('pt-BR');
const formatoLista = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });
const plural = (n, um, varios) => `${n} ${regrasPlural.select(n) === 'one' ? um : varios}`;
const capitalizar = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

const esc = (texto) =>
  String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const doisDigitos = (n) => String(n).padStart(2, '0');

// Montado à mão: alguns navegadores escrevem 24:10 em vez de 00:10 com os formatos prontos.
function horaAgora() {
  const d = new Date();
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

function hojeIso() {
  const d = new Date();
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

/* Estado da sessão */
let versaoRota = 0;
let navegacoes = 0;
let telaAtual = '';
let tituloAtual = NOME_APP;
let rolagemInicio = 0;
let ultimoHashFocado = null;
let form = null;
let formBase = '';
let formHash = '';
let sugestoes = { pecas: [], ofs: [] };
let alvoFoto = null;
let preparo = null;
let relatorioAberto = null;
let turnoEmEdicao = null;
let pedidoInstalacao = null;
let timerToast;
const processando = new Map();
const errosFoto = new Map();
const urlsMiniatura = new Map();

function urlMiniatura(foto) {
  if (!urlsMiniatura.has(foto.id)) urlsMiniatura.set(foto.id, URL.createObjectURL(foto.miniatura));
  return urlsMiniatura.get(foto.id);
}

function esquecerMiniatura(id) {
  const url = urlsMiniatura.get(id);
  if (url) URL.revokeObjectURL(url);
  urlsMiniatura.delete(id);
}

async function turnoAtual() {
  const id = await db.lerConfig('turnoAtualId');
  return id ? db.obter('turnos', id) : null;
}

/* Navegação */
const ROTAS = [
  [/^#\/$/, () => telaTurno()],
  [/^#\/nova$/, () => telaFormulario({})],
  [/^#\/nova\/(lpf|reinspecao)\/([\w-]+)$/, (acao, origemId) => telaFormulario({ acao, origemId })],
  [/^#\/item\/([\w-]+)$/, (id) => telaFormulario({ id })],
  [/^#\/relatorio$/, () => telaRelatorio()],
  [/^#\/relatorio\/([\w-]+)$/, (id) => telaRelatorio(id)],
  [/^#\/historico$/, () => telaHistorico()],
  [/^#\/turno\/(novo|editar)$/, (modo) => telaDadosTurno(modo)],
];

async function rotear() {
  const hash = location.hash || '#/';
  if (form && hash !== formHash) {
    if (formAlterado()) {
      // Voltou pelo botão do aparelho com dado preenchido: fica na tela e pergunta.
      history.pushState(null, '', formHash);
      perguntarSaida();
      return;
    }
    form = null;
    limparRascunho();
  }
  const versao = ++versaoRota;
  if (telaAtual === 'turno') rolagemInicio = window.scrollY;
  for (const [padrao, tela] of ROTAS) {
    const achou = hash.match(padrao);
    if (achou) {
      try {
        await tela(...achou.slice(1));
      } catch (erro) {
        console.error(erro);
        if (versao === versaoRota) telaErro();
      }
      return;
    }
  }
  telaNaoEncontrada();
}

function voltar(destino = '#/') {
  if (navegacoes > 0) history.back();
  else location.replace(destino);
}

function htmlNav(ativa) {
  return ABAS.map(
    (aba) =>
      `<a class="nav-item" href="${aba.href}"${aba.id === ativa ? ' aria-current="page"' : ''}>${icone(aba.icone, 24)}<span>${aba.nome}</span></a>`,
  ).join('');
}

function pintar(nome, html, { titulo, rolagem = 0, aba = null, acao = '' }) {
  telaAtual = nome;
  tituloAtual = `${titulo} | ${NOME_APP}`;
  document.title = tituloAtual;
  app.innerHTML = html;
  dockAcao.innerHTML = acao;
  dockAcao.hidden = !acao;
  elNav.hidden = !aba;
  elNav.innerHTML = aba ? htmlNav(aba) : '';
  dock.hidden = !acao && !aba;
  window.scrollTo(0, rolagem);
  // Em troca de tela, o foco vai para o título (A11-16).
  if (location.hash !== ultimoHashFocado) {
    ultimoHashFocado = location.hash;
    app.querySelector('h1')?.focus({ preventScroll: true });
  }
}

function barra(titulo) {
  return `
    <header class="barra">
      <button class="btn-icone" type="button" data-acao="voltar" aria-label="Voltar">${icone('voltar', 24)}</button>
      <h1 tabindex="-1">${esc(titulo)}</h1>
      <span></span>
    </header>`;
}

function htmlVazio({ iconeNome, titulo, apoio, botao = '', tituloDaTela = false }) {
  return `
    <div class="vazio">
      ${icone(iconeNome, 32)}
      ${tituloDaTela ? `<h1 tabindex="-1">${esc(titulo)}</h1>` : `<h2>${esc(titulo)}</h2>`}
      <p>${esc(apoio)}</p>
      ${botao}
    </div>`;
}

const botaoPrincipal = (href, rotulo, iconeNome) =>
  `<a class="btn btn-primario btn-bloco" href="${href}">${iconeNome ? icone(iconeNome, 16, { bold: true }) : ''}${esc(rotulo)}</a>`;

function telaNaoEncontrada() {
  pintar(
    'nao-encontrada',
    `${barra('Tela não encontrada')}
    <div class="tela">
      ${htmlVazio({
        iconeNome: 'aviso',
        titulo: 'Este endereço não existe',
        apoio: 'A inspeção pode ter sido excluída.',
        botao: '<a class="btn btn-secundario btn-md" href="#/">Voltar para o turno</a>',
      })}
    </div>`,
    { titulo: 'Tela não encontrada' },
  );
}

function telaErro() {
  pintar(
    'erro',
    `<div class="tela">
      ${htmlVazio({
        iconeNome: 'aviso',
        titulo: 'Não foi possível abrir os dados',
        apoio: 'Feche e abra o app. Em aba anônima o navegador pode bloquear o armazenamento.',
        botao: '<button class="btn btn-secundario btn-md" type="button" data-acao="recarregar">Tentar de novo</button>',
        tituloDaTela: true,
      })}
    </div>`,
    { titulo: 'Erro' },
  );
}

/* Tela do turno */
function partesContagem(itens, fotos) {
  const partes = [];
  if (itens.length) partes.push(plural(itens.length, 'inspeção', 'inspeções'));
  if (fotos.length) partes.push(plural(fotos.length, 'foto', 'fotos'));
  return partes;
}

function resumoTurno(itens, fotos) {
  const partes = partesContagem(itens, fotos);
  const semStatus = itens.filter((i) => !i.status).length;
  if (semStatus) partes.push(`${semStatus} sem status`);
  return formatoLista.format(partes);
}

function htmlTagStatus(item) {
  if (!item.status) return '';
  const meta = STATUS.find((s) => s.valor === item.status);
  return `<span class="tag" data-cor="${meta ? meta.cor : 'neutro'}">${icone(meta ? meta.icone : 'ponto', 16)}<span class="tag-texto">${esc(capitalizar(textoStatus(item)))}</span></span>`;
}

function htmlAcoesCard(item) {
  if (!item.status) {
    const chips = STATUS
      .map(
        (s) =>
          `<button class="chip" type="button" data-acao="card-status" data-id="${item.id}" data-v="${esc(s.valor)}">${esc(s.curto)}</button>`,
      )
      .join('');
    return `<div class="chips card-sobre" role="group" aria-label="Definir status">${chips}</div>`;
  }
  const acao = proximaAcao(item);
  return acao
    ? `<a class="btn btn-secundario btn-md btn-bloco card-sobre" href="#/nova/${acao.acao}/${item.id}">${esc(acao.rotulo)}</a>`
    : '';
}

function htmlCard(item, fotos) {
  const pendentes = processando.get(item.id) || 0;
  const visiveis = fotos.length > MINIATURAS_NO_CARD ? fotos.slice(0, MINIATURAS_NO_CARD - 1) : fotos;
  const restantes = fotos.length - visiveis.length;
  const nome = descricaoPeca(item);
  const miniaturas =
    visiveis
      .map((f) => `<img class="mini" src="${urlMiniatura(f)}" alt="Foto de ${esc(nome)}" width="64" height="64" />`)
      .join('') +
    (restantes > 0 ? `<span class="mini">+${restantes}</span>` : '') +
    '<span class="mini esqueleto"></span>'.repeat(pendentes);
  const erro = errosFoto.get(item.id);

  return `
    <article class="card card-clicavel">
      <div class="card-info">
        <div class="card-topo">
          <span class="card-etapa">${esc(rotuloEtapa(item))}</span>
          ${htmlTagStatus(item)}
        </div>
        <div class="card-corpo">
          <a class="card-link" href="#/item/${item.id}">
            <span class="card-titulo">${esc(nome)}</span>
            <span class="card-of">${esc(textoOf(item))}${icone('avancar', 16)}</span>
            ${item.obs ? `<span class="card-obs">Obs: ${esc(item.obs)}</span>` : ''}
          </a>
          <button class="btn-icone card-sobre" type="button" data-acao="card-foto" data-id="${item.id}" data-turno="${item.turnoId}" aria-label="Adicionar foto de ${esc(nome)}">${icone('camera', 24)}</button>
        </div>
        ${miniaturas ? `<div class="miniaturas">${miniaturas}</div>` : ''}
        ${erro ? `<p class="erro-campo">${esc(erro)}</p>` : ''}
      </div>
      ${htmlAcoesCard(item)}
    </article>`;
}

async function telaTurno() {
  const versao = versaoRota;
  const turno = await turnoAtual();
  if (versao !== versaoRota) return;

  if (!turno) {
    pintar(
      'turno',
      `<div class="tela">
        <header class="cabecalho"><h1 tabindex="-1">Turno</h1></header>
        ${htmlVazio({
          iconeNome: 'turno',
          titulo: 'Nenhum turno aberto',
          apoio: 'Abra um turno para registrar as inspeções.',
        })}
      </div>`,
      { titulo: 'Turno', aba: 'turno', acao: botaoPrincipal('#/turno/novo', 'Abrir turno') },
    );
    return;
  }

  const [itens, fotos] = await Promise.all([db.itensDoTurno(turno.id), db.fotosDoTurno(turno.id)]);
  if (versao !== versaoRota) return;

  const fotosPorItem = new Map();
  fotos.forEach((f) => fotosPorItem.set(f.itemId, [...(fotosPorItem.get(f.itemId) || []), f]));
  const horas = Math.floor((Date.now() - turno.criadoEm) / 3600000);
  const titulo = [turno.cliente, dataCurta(turno.data)].filter(Boolean).join(', ');

  pintar(
    'turno',
    `<div class="tela">
      <header class="cabecalho">
        <a class="btn-icone cabecalho-acao" href="#/turno/editar" aria-label="Editar dados do turno">${icone('lapis', 24)}</a>
        <h1 tabindex="-1">${esc(titulo)}</h1>
        ${turno.equipe ? `<p class="cabecalho-equipe">${esc(turno.equipe)}</p>` : ''}
        ${itens.length ? `<p class="nota">${esc(resumoTurno(itens, fotos))}</p>` : ''}
      </header>
      ${
        horas >= HORAS_PARA_AVISAR_TURNO
          ? `<div class="banner">
              <p>Este turno começou há ${esc(plural(horas, 'hora', 'horas'))}.</p>
              <button class="btn btn-secundario btn-md btn-bloco" type="button" data-acao="encerrar-turno">Encerrar e abrir outro turno</button>
            </div>`
          : ''
      }
      ${
        itens.length
          ? `<div class="lista">${[...itens].reverse().map((i) => htmlCard(i, fotosPorItem.get(i.id) || [])).join('')}</div>`
          : htmlVazio({
              iconeNome: 'turno',
              titulo: 'Nenhuma inspeção neste turno',
              apoio: 'A primeira inspeção registrada aparece aqui.',
            })
      }
    </div>`,
    { titulo, aba: 'turno', rolagem: rolagemInicio, acao: botaoPrincipal('#/nova', 'Registrar inspeção', 'mais') },
  );
}

async function definirStatusDoCard(id, status) {
  const item = await db.obter('itens', id);
  if (!item) return;
  await db.gravar('itens', { ...item, status, qtdPendente: null });
  // Lote com várias peças: abre a edição para dizer quantas ficaram pendentes.
  if (status === 'Pendente' && item.qtd > 1) location.hash = `#/item/${id}`;
  else telaTurno();
}

/* Formulário da inspeção */
function camposDoForm(f) {
  const { tipo, penetracao, revelador, reinspecao, hora, peca, qtd, of, status, qtdPendente, obs } = f;
  return JSON.stringify({ tipo, penetracao, revelador, reinspecao, hora, peca, qtd, of, status, qtdPendente, obs });
}

function formAlterado() {
  return Boolean(form) && (camposDoForm(form) !== formBase || Boolean(form.fotosAlteradas));
}

function lerRascunho() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_RASCUNHO));
  } catch {
    return null;
  }
}

function salvarRascunho() {
  try {
    if (form) localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify({ hash: formHash, form, base: formBase }));
  } catch {
    /* Sem rascunho o formulário continua funcionando. */
  }
}

function limparRascunho() {
  try {
    localStorage.removeItem(CHAVE_RASCUNHO);
  } catch {
    /* Nada a limpar. */
  }
}

function formParaItem(f) {
  const qtd = parseInt(f.qtd, 10) || null;
  return {
    id: f.id,
    turnoId: f.turnoId,
    criadoEm: f.criadoEm,
    tipo: f.tipo,
    penetracao: f.penetracao,
    revelador: f.revelador,
    reinspecao: f.reinspecao,
    hora: f.hora || horaAgora(),
    peca: f.peca.trim(),
    qtd,
    of: f.of.trim().replace(/-$/, ''),
    status: f.status,
    qtdPendente: f.status === 'Pendente' && qtd > 1 ? parseInt(f.qtdPendente, 10) || null : null,
    obs: f.obs.trim(),
  };
}

// O catálogo fica fora dos turnos: excluir turno antigo não apaga o que o app aprendeu.
async function aprenderPeca(nome, nomeAnterior) {
  const chave = semAcento(nome);
  const anterior = nomeAnterior && semAcento(nomeAnterior);
  if (chave === anterior) return;
  const catalogo = (await db.lerConfig('pecas')) || {};
  catalogo[chave] = { nome, usos: (catalogo[chave]?.usos || 0) + 1 };
  // Renomear corrige digitação errada: o nome antigo deixa de ser sugerido.
  if (anterior && catalogo[anterior]) {
    catalogo[anterior].usos -= 1;
    if (catalogo[anterior].usos <= 0) delete catalogo[anterior];
  }
  await db.gravarConfig('pecas', catalogo);
}

function mostrarErroPeca() {
  const campo = $('f-peca');
  $('erro-peca').hidden = false;
  campo.setAttribute('aria-invalid', 'true');
  document.title = `Erro: ${tituloAtual}`;
  campo.focus();
}

function limparErroPeca() {
  $('erro-peca').hidden = true;
  $('f-peca').removeAttribute('aria-invalid');
  document.title = tituloAtual;
}

async function salvarFormulario() {
  if (!form) return;
  if (!form.peca.trim()) {
    mostrarErroPeca();
    return;
  }
  const f = form;
  await db.gravar('itens', formParaItem(f));
  await aprenderPeca(f.peca.trim(), f.pecaOriginal);
  form = null;
  limparRascunho();
  voltar();
}

async function descartarFormulario() {
  if (!form) return;
  const f = form;
  form = null;
  limparRascunho();
  if (f.novo) await db.excluirFotosDoItem(f.id);
  voltar();
}

async function perguntarSaida() {
  if (dialogo.open || !form) return;
  const escolha = await confirmar({
    titulo: 'Salvar esta inspeção?',
    texto: 'O que foi preenchido ainda não foi salvo.',
    acao: 'Salvar inspeção',
    estiloAcao: 'btn-primario',
    alternativa: form.novo ? 'Descartar inspeção' : 'Descartar alterações',
    cancelar: 'Continuar preenchendo',
  });
  if (escolha === 'sim') salvarFormulario();
  else if (escolha === 'alternativa') descartarFormulario();
}

function sairDoFormulario() {
  if (formAlterado()) {
    perguntarSaida();
    return;
  }
  form = null;
  limparRascunho();
  voltar();
}

function formVazio(turno, anterior) {
  return {
    id: uid(),
    turnoId: turno.id,
    novo: true,
    criadoEm: Date.now(),
    tipo: anterior?.tipo || 'LP',
    penetracao: true,
    revelador: true,
    reinspecao: false,
    hora: horaAgora(),
    peca: '',
    qtd: '',
    of: '',
    status: '',
    qtdPendente: '',
    obs: '',
  };
}

function itemParaForm(item) {
  return {
    ...item,
    novo: false,
    pecaOriginal: item.peca,
    qtd: item.qtd ?? '',
    qtdPendente: item.qtdPendente ?? '',
    obs: item.obs ?? '',
  };
}

function calcularSugestoes(todosItens, turnoId, catalogo) {
  const pecas = Object.values(catalogo)
    .sort((a, b) => b.usos - a.usos)
    .map((p) => p.nome);

  // OFs do turno vêm primeiro; depois as usadas por último.
  const recentes = [...todosItens].filter((i) => i.of).sort((a, b) => {
    const mesmoTurno = (b.turnoId === turnoId) - (a.turnoId === turnoId);
    return mesmoTurno || b.criadoEm - a.criadoEm;
  });
  const ofs = [...new Set(recentes.map((i) => i.of))].slice(0, 6);
  return { pecas, ofs };
}

const chipAlternavel = (campo, rotulo) =>
  `<button class="chip" type="button" data-acao="alternar" data-campo="${campo}"><span class="chip-marca"></span>${rotulo}</button>`;

function htmlFormulario(f) {
  return `
    ${barra(f.novo ? 'Nova inspeção' : 'Editar inspeção')}
    <div class="tela">
      <form class="form" id="form-item" novalidate>
        <fieldset class="campo">
          <legend>Tipo</legend>
          <div class="seg">
            <button class="seg-op" type="button" data-acao="tipo" data-v="LP">LP</button>
            <button class="seg-op" type="button" data-acao="tipo" data-v="LPF">LPF</button>
          </div>
          <div class="chips">${chipAlternavel('reinspecao', 'Reinspeção')}</div>
        </fieldset>

        <fieldset class="campo">
          <legend>Etapa</legend>
          <div class="chips">
            ${chipAlternavel('penetracao', 'Penetração')}
            ${chipAlternavel('revelador', 'Revelador')}
          </div>
        </fieldset>

        <div class="campo" id="campo-hora">
          <label class="campo-rotulo" for="f-hora">Hora</label>
          <input class="entrada entrada-curta" id="f-hora" type="time" value="${esc(f.hora)}" />
        </div>

        <div class="campo">
          <label class="campo-rotulo" for="f-peca">Peça *</label>
          <input class="entrada" id="f-peca" type="text" value="${esc(f.peca)}" aria-required="true" aria-describedby="erro-peca" autocomplete="off" autocapitalize="off" enterkeyhint="next" />
          <p class="erro-campo" id="erro-peca" hidden>Informe o nome da peça para salvar.</p>
          <div class="chips" id="sug-peca"></div>
        </div>

        <div class="campo">
          <label class="campo-rotulo" for="f-qtd">Quantidade (opcional)</label>
          <input class="entrada entrada-curta" id="f-qtd" type="text" inputmode="numeric" value="${esc(f.qtd)}" autocomplete="off" enterkeyhint="next" />
        </div>

        <div class="campo">
          <label class="campo-rotulo" for="f-of">OF (opcional)</label>
          <input class="entrada" id="f-of" type="text" value="${esc(f.of)}" autocomplete="off" autocapitalize="characters" enterkeyhint="done" />
          <div class="chips" id="sug-of"></div>
        </div>

        <fieldset class="campo">
          <legend>Status</legend>
          <div class="chips" id="op-status"></div>
          <div class="campo" id="campo-qtd-pendente" hidden>
            <label class="campo-rotulo" for="f-qtd-pendente">Quantas ficaram pendentes</label>
            <input class="entrada entrada-curta" id="f-qtd-pendente" type="text" inputmode="numeric" value="${esc(f.qtdPendente)}" autocomplete="off" enterkeyhint="done" />
          </div>
        </fieldset>

        <div class="campo">
          <label class="campo-rotulo" for="f-obs">Observações (opcional)</label>
          <textarea class="entrada entrada-area" id="f-obs" rows="3" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter">${esc(f.obs)}</textarea>
        </div>

        <div class="campo">
          <span class="campo-rotulo">Fotos</span>
          <div class="fotos" id="lista-fotos"></div>
          <p class="erro-campo" id="erro-fotos" hidden></p>
          <div class="pilha">
            <button class="btn btn-secundario btn-bloco" type="button" data-acao="foto-camera">${icone('camera', 16)}Tirar foto</button>
            <button class="btn btn-secundario btn-bloco" type="button" data-acao="foto-galeria">${icone('galeria', 16)}Escolher da galeria</button>
          </div>
        </div>

        <div class="pilha encerramento">
          ${
            f.novo
              ? '<button class="btn btn-perigo btn-bloco" type="button" data-acao="descartar">Descartar inspeção</button>'
              : `<button class="btn btn-perigo btn-bloco" type="button" data-acao="excluir-item">${icone('lixeira', 16)}Excluir inspeção</button>`
          }
        </div>
      </form>
    </div>`;
}

function pintarEscolhas() {
  app.querySelectorAll('[data-acao="tipo"]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === form.tipo));
  app.querySelectorAll('[data-acao="alternar"]').forEach((b) => {
    const ligado = form[b.dataset.campo];
    b.setAttribute('aria-pressed', ligado);
    b.querySelector('.chip-marca').innerHTML = ligado ? icone('check', 16, { bold: true }) : '';
  });
  // A hora só sai no relatório quando a linha é só de penetração.
  $('campo-hora').hidden = !(form.penetracao && !form.revelador);
}

function htmlChipsTexto(lista, acao) {
  return lista
    .map((v) => `<button class="chip chip-texto" type="button" data-acao="${acao}" data-v="${esc(v)}"><span>${esc(v)}</span></button>`)
    .join('');
}

function pintarSugestoesPeca() {
  const busca = semAcento(form.peca.trim());
  const lista = busca
    ? sugestoes.pecas
        .filter((p) => {
          const nome = semAcento(p);
          return nome !== busca && nome.includes(busca);
        })
        .slice(0, 6)
    : [];
  $('sug-peca').innerHTML = htmlChipsTexto(lista, 'escolher-peca');
}

function pintarSugestoesOf() {
  const busca = form.of.trim();
  $('sug-of').innerHTML = htmlChipsTexto(
    sugestoes.ofs.filter((o) => o !== busca && o.includes(busca)),
    'escolher-of',
  );
}

function pintarStatus() {
  const opcoes = STATUS.map(
    (s) =>
      `<button class="chip" type="button" data-cor="${s.cor}" data-acao="status" data-v="${esc(s.valor)}" aria-pressed="${form.status === s.valor}">${icone(s.icone, 16)}${esc(s.valor)}</button>`,
  ).join('');
  $('op-status').innerHTML = opcoes;
  $('campo-qtd-pendente').hidden = !(form.status === 'Pendente' && Number(form.qtd) > 1);
}

async function pintarFotos() {
  if (!form) return;
  const id = form.id;
  const fotos = await db.fotosDoItem(id);
  if (!form || form.id !== id) return;
  const nome = form.peca.trim() || 'peça';
  $('lista-fotos').innerHTML =
    fotos
      .map(
        (f) => `
        <div class="foto">
          <img src="${urlMiniatura(f)}" alt="Foto de ${esc(nome)}" width="96" height="96" />
          <button class="foto-x" type="button" data-acao="remover-foto" data-id="${f.id}" aria-label="Remover foto">${icone('x', 16)}</button>
        </div>`,
      )
      .join('') + '<div class="foto"><div class="esqueleto"></div></div>'.repeat(processando.get(id) || 0);
  const erro = errosFoto.get(id);
  $('erro-fotos').hidden = !erro;
  $('erro-fotos').textContent = erro || '';
}

async function telaFormulario({ id, acao, origemId }) {
  const versao = versaoRota;
  const turno = await turnoAtual();
  const rascunho = lerRascunho();
  let inicial;
  let base;

  if (rascunho && rascunho.hash === location.hash) {
    inicial = rascunho.form;
    base = rascunho.base;
  } else if (id) {
    const item = await db.obter('itens', id);
    if (!item) {
      telaNaoEncontrada();
      return;
    }
    inicial = itemParaForm(item);
  } else {
    if (!turno) {
      location.replace('#/turno/novo');
      return;
    }
    const itens = await db.itensDoTurno(turno.id);
    inicial = formVazio(turno, itens[itens.length - 1]);
    if (acao) {
      const origem = await db.obter('itens', origemId);
      if (origem) {
        const dados = dadosProximaAcao(origem, acao, horaAgora());
        inicial = { ...inicial, ...dados, qtd: dados.qtd ?? '', qtdPendente: '' };
      }
    }
  }

  const [todosItens, catalogo] = await Promise.all([db.todos('itens'), db.lerConfig('pecas')]);
  if (versao !== versaoRota) return;

  sugestoes = calcularSugestoes(todosItens, inicial.turnoId, catalogo || {});
  form = inicial;
  formHash = location.hash;
  formBase = base ?? camposDoForm(form);
  pintar('formulario', htmlFormulario(form), {
    titulo: form.novo ? 'Nova inspeção' : 'Editar inspeção',
    acao: '<button class="btn btn-primario btn-bloco" type="submit" form="form-item">Salvar inspeção</button>',
  });
  pintarEscolhas();
  pintarSugestoesPeca();
  pintarSugestoesOf();
  pintarStatus();
  pintarFotos();
}

function aoDigitar(evento) {
  if (!form) return;
  const alvo = evento.target;
  if (alvo.id === 'f-peca') {
    form.peca = alvo.value;
    limparErroPeca();
    pintarSugestoesPeca();
  } else if (alvo.id === 'f-of') {
    const noFim = alvo.selectionStart === alvo.value.length;
    if (noFim) alvo.value = formatarOf(alvo.value);
    form.of = alvo.value;
    pintarSugestoesOf();
  } else if (alvo.id === 'f-qtd') {
    alvo.value = alvo.value.replace(/\D/g, '');
    form.qtd = alvo.value;
    pintarStatus();
  } else if (alvo.id === 'f-qtd-pendente') {
    alvo.value = alvo.value.replace(/\D/g, '');
    form.qtdPendente = alvo.value;
  } else if (alvo.id === 'f-obs') {
    form.obs = alvo.value;
  } else if (alvo.id === 'f-hora') {
    form.hora = alvo.value;
  } else {
    return;
  }
  salvarRascunho();
}

function aoTeclar(evento) {
  if (evento.key !== 'Enter' || evento.target.tagName !== 'INPUT') return;
  evento.preventDefault();
  const proximo = { 'f-peca': 'f-qtd', 'f-qtd': 'f-of', 't-cliente': 't-equipe' }[evento.target.id];
  if (proximo) $(proximo).focus();
  else evento.target.blur();
}

/* Fotos */
function pedirFoto(input, itemId, turnoId) {
  alvoFoto = { itemId, turnoId };
  salvarRascunho();
  input.click();
}

function repintarFotos() {
  if (form) pintarFotos();
  else if (telaAtual === 'turno') telaTurno();
}

async function aoEscolherFotos(evento) {
  const arquivos = [...evento.target.files];
  evento.target.value = '';
  const alvo = alvoFoto;
  if (!arquivos.length || !alvo) return;
  errosFoto.delete(alvo.itemId);
  processando.set(alvo.itemId, (processando.get(alvo.itemId) || 0) + arquivos.length);
  repintarFotos();

  for (const arquivo of arquivos) {
    try {
      const { blob, miniatura } = await processarFoto(arquivo);
      await db.gravar('fotos', { id: uid(), itemId: alvo.itemId, turnoId: alvo.turnoId, blob, miniatura, criadoEm: Date.now() });
      if (form?.id === alvo.itemId && form.novo) {
        form.fotosAlteradas = true;
        salvarRascunho();
      }
    } catch (erro) {
      errosFoto.set(alvo.itemId, erro?.name === 'QuotaExceededError' ? MENSAGEM_ESPACO : MENSAGEM_FOTO);
    }
    processando.set(alvo.itemId, processando.get(alvo.itemId) - 1);
    repintarFotos();
  }
  if (!processando.get(alvo.itemId)) processando.delete(alvo.itemId);
}

async function removerFoto(id) {
  const foto = await db.obter('fotos', id);
  if (!foto) return;
  await db.apagar('fotos', id);
  esquecerMiniatura(id);
  pintarFotos();
  mostrarToast('Foto removida', 'Desfazer', async () => {
    await db.gravar('fotos', foto);
    pintarFotos();
  });
}

/* Relatório */
function rotuloLote(indice, total, verbo, feito) {
  const inicio = indice * FOTOS_POR_ENVIO + 1;
  const fim = Math.min(inicio + FOTOS_POR_ENVIO - 1, total);
  if (feito) {
    const passado = verbo === 'Enviar' ? 'enviada' : 'baixada';
    return inicio === fim ? `Foto ${inicio} ${passado}` : `Fotos ${inicio} a ${fim} ${passado}s`;
  }
  return inicio === fim ? `${verbo} foto ${inicio}` : `${verbo} fotos ${inicio} a ${fim}`;
}

function pintarLotes() {
  const area = $('area-fotos');
  if (!area || !preparo) return;
  const { arquivos, total, pronto, enviados, falhas, erroEnvio } = preparo;
  area.hidden = !total;
  if (!total) return;
  if (!pronto) {
    const lotes = Math.ceil(total / FOTOS_POR_ENVIO);
    area.innerHTML = `
      <h2>Fotos</h2>
      <p class="nota" role="status">Preparando foto ${Math.min(arquivos.length + falhas + 1, total)} de ${total}…</p>
      <div class="pilha">${'<div class="esqueleto esqueleto-botao btn-bloco"></div>'.repeat(lotes)}</div>`;
    return;
  }
  const compartilha = Boolean(navigator.canShare && arquivos.length && navigator.canShare({ files: arquivos.slice(0, 1) }));
  const verbo = compartilha ? 'Enviar' : 'Baixar';
  const botoes = [];
  for (let i = 0; i * FOTOS_POR_ENVIO < arquivos.length; i += 1) {
    const feito = enviados.has(i);
    botoes.push(
      `<button class="btn btn-secundario btn-bloco" type="button" data-acao="enviar-lote" data-lote="${i}">${icone(feito ? 'check' : compartilha ? 'enviar' : 'baixar', 16, { bold: feito })}${esc(rotuloLote(i, arquivos.length, verbo, feito))}</button>`,
    );
  }
  area.innerHTML = `
    <h2>Fotos</h2>
    <p class="nota">Cada foto sai com a OF, a peça e o status escritos embaixo.</p>
    ${falhas ? `<p class="erro-campo">${esc(plural(falhas, 'foto não pôde ser preparada', 'fotos não puderam ser preparadas'))}. Abra o relatório de novo para tentar.</p>` : ''}
    ${erroEnvio ? `<p class="erro-campo">${esc(erroEnvio)}</p>` : ''}
    <div class="pilha">${botoes.join('')}</div>`;
}

// As fotos ficam prontas antes do toque: o celular só abre o compartilhar logo depois de um toque.
async function prepararFotos(turno, itens, fotos, versao) {
  const posicao = new Map(itens.map((i, n) => [i.id, n]));
  const ordenadas = [...fotos].sort((a, b) => posicao.get(a.itemId) - posicao.get(b.itemId) || a.criadoEm - b.criadoEm);
  const assinatura = JSON.stringify([montarRelatorio(turno, itens), ordenadas.map((f) => f.id)]);
  if (preparo?.assinatura === assinatura && preparo.pronto && !preparo.falhas) {
    pintarLotes();
    return;
  }
  const atual = { assinatura, arquivos: [], enviados: new Set(), pronto: false, total: ordenadas.length, falhas: 0, erroEnvio: '' };
  preparo = atual;
  pintarLotes();
  const itemPorId = new Map(itens.map((i) => [i.id, i]));
  for (const foto of ordenadas) {
    if (preparo !== atual || versao !== versaoRota) return;
    const item = itemPorId.get(foto.itemId);
    try {
      const nome = nomeArquivoFoto(atual.arquivos.length + 1, item);
      atual.arquivos.push(await carimbarFoto(foto.blob, legendaFoto(turno, item), nome));
    } catch {
      atual.falhas += 1;
    }
    pintarLotes();
  }
  atual.pronto = true;
  pintarLotes();
}

function htmlAlertaStatus(itens) {
  const semStatus = itens.filter((i) => !i.status);
  if (!semStatus.length) {
    return `<div class="alerta alerta-sucesso"><p class="alerta-titulo">${icone('check', 16, { bold: true })}Todas as inspeções têm status.</p></div>`;
  }
  return `
    <section class="alerta alerta-aviso">
      <p class="alerta-titulo">${icone('aviso', 16)}${esc(plural(semStatus.length, 'inspeção', 'inspeções'))} sem status</p>
      ${semStatus.map((i) => `<a class="alerta-link" href="#/item/${i.id}">${esc(linhaItem(i).slice(2))}</a>`).join('')}
    </section>`;
}

async function telaRelatorio(id) {
  const versao = versaoRota;
  const atualId = await db.lerConfig('turnoAtualId');
  const turno = await db.obter('turnos', id || atualId || '');
  if (versao !== versaoRota) return;

  if (!turno) {
    if (id) {
      telaNaoEncontrada();
      return;
    }
    pintar(
      'relatorio',
      `<div class="tela">
        <header class="cabecalho"><h1 tabindex="-1">Relatório</h1></header>
        ${htmlVazio({
          iconeNome: 'relatorio',
          titulo: 'Nenhum turno aberto',
          apoio: 'O relatório nasce das inspeções do turno.',
          botao: '<a class="btn btn-secundario btn-md" href="#/turno/novo">Abrir turno</a>',
        })}
      </div>`,
      { titulo: 'Relatório', aba: 'relatorio' },
    );
    return;
  }

  const [itens, fotos] = await Promise.all([db.itensDoTurno(turno.id), db.fotosDoTurno(turno.id)]);
  if (versao !== versaoRota) return;

  const texto = montarRelatorio(turno, itens);
  const ehAtual = turno.id === atualId;
  relatorioAberto = { turno, texto, itens, fotos };

  const corpo = itens.length
    ? `
      ${htmlAlertaStatus(itens)}
      <div class="previa" id="previa">${esc(texto)}</div>
      <p id="erro-texto" class="erro-campo" hidden></p>
      <div class="pilha">
        <button class="btn btn-primario btn-bloco" type="button" data-acao="enviar-texto">${icone('enviar', 16, { bold: true })}<span aria-live="polite">Enviar texto no WhatsApp</span></button>
        <button class="btn btn-secundario btn-bloco" type="button" data-acao="copiar-texto">${icone('copiar', 16)}<span aria-live="polite">Copiar texto</span></button>
      </div>
      <section class="bloco" id="area-fotos"></section>`
    : htmlVazio({
        iconeNome: 'relatorio',
        titulo: 'Nada para relatar ainda',
        apoio: 'As inspeções registradas no turno aparecem aqui.',
      });

  pintar(
    'relatorio',
    `${id ? barra('Relatório') : ''}
    <div class="tela">
      ${id ? '' : '<header class="cabecalho"><h1 tabindex="-1">Relatório</h1></header>'}
      ${corpo}
      <section class="pilha encerramento">
        ${
          ehAtual
            ? '<button class="btn btn-secundario btn-bloco" type="button" data-acao="encerrar-turno">Encerrar turno</button>'
            : '<button class="btn btn-secundario btn-bloco" type="button" data-acao="reabrir-turno">Reabrir turno</button>'
        }
        <button class="btn btn-perigo btn-bloco" type="button" data-acao="excluir-turno">${icone('lixeira', 16)}Excluir turno</button>
      </section>
    </div>`,
    { titulo: 'Relatório', aba: id ? null : 'relatorio' },
  );
  if (itens.length) prepararFotos(turno, itens, fotos, versao);
}

// Copiar e enviar confirmam no próprio botão, sem mudar a largura (CTL-19, MOT-06).
function confirmarNoBotao(botao, rotulo) {
  botao.conteudoOriginal ??= botao.innerHTML;
  botao.style.minWidth = `${botao.offsetWidth}px`;
  botao.innerHTML = `${icone('check', 16, { bold: true })}<span aria-live="polite">${esc(rotulo)}</span>`;
  clearTimeout(botao.temporizador);
  botao.temporizador = setTimeout(() => {
    botao.innerHTML = botao.conteudoOriginal;
  }, 1600);
}

async function enviarTexto(botao) {
  const { texto } = relatorioAberto;
  if (navigator.share) {
    try {
      await navigator.share({ text: texto });
      confirmarNoBotao(botao, 'Texto enviado');
      return;
    } catch (erro) {
      if (erro.name === 'AbortError') return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
}

async function copiarTexto(botao) {
  const aviso = $('erro-texto');
  try {
    await navigator.clipboard.writeText(relatorioAberto.texto);
    aviso.hidden = true;
    confirmarNoBotao(botao, 'Texto copiado');
  } catch {
    aviso.hidden = false;
    aviso.textContent = 'Não foi possível copiar. Toque e segure no texto acima para copiar.';
  }
}

function baixarArquivos(arquivos) {
  arquivos.forEach((arquivo, n) => {
    setTimeout(() => {
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement('a');
      link.href = url;
      link.download = arquivo.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, n * 300);
  });
}

async function enviarLote(indice) {
  const lote = preparo.arquivos.slice(indice * FOTOS_POR_ENVIO, (indice + 1) * FOTOS_POR_ENVIO);
  preparo.erroEnvio = '';
  if (navigator.canShare && navigator.canShare({ files: lote })) {
    try {
      await navigator.share({ files: lote });
    } catch (erro) {
      if (erro.name === 'AbortError') return;
      preparo.erroEnvio = 'O celular não conseguiu compartilhar estas fotos. Toque de novo para tentar.';
      pintarLotes();
      return;
    }
  } else {
    baixarArquivos(lote);
  }
  preparo.enviados.add(indice);
  pintarLotes();
}

async function encerrarTurno() {
  const turno = await turnoAtual();
  if (!turno) return;
  await db.gravar('turnos', { ...turno, encerradoEm: Date.now() });
  await db.gravarConfig('turnoAtualId', null);
  location.hash = '#/';
  mostrarToast('Turno encerrado', 'Desfazer', async () => {
    await db.gravar('turnos', { ...turno, encerradoEm: null });
    await db.gravarConfig('turnoAtualId', turno.id);
    rotear();
  });
}

async function reabrirTurno() {
  const { turno } = relatorioAberto;
  await db.gravar('turnos', { ...turno, encerradoEm: null });
  await db.gravarConfig('turnoAtualId', turno.id);
  location.hash = '#/';
}

async function excluirTurno() {
  const { turno, itens, fotos } = relatorioAberto;
  const conteudo = formatoLista.format(partesContagem(itens, fotos));
  const escolha = await confirmar({
    titulo: `Excluir o turno de ${dataCurta(turno.data)}?`,
    texto: conteudo
      ? `Este turno tem ${conteudo}. Tudo será apagado deste celular e não tem como recuperar.`
      : 'Este turno está vazio e será apagado deste celular.',
    acao: 'Excluir turno',
    cancelar: 'Manter turno',
  });
  if (escolha !== 'sim') return;
  await db.excluirTurno(turno.id);
  fotos.forEach((f) => esquecerMiniatura(f.id));
  if ((await db.lerConfig('turnoAtualId')) === turno.id) await db.gravarConfig('turnoAtualId', null);
  location.replace('#/historico');
}

/* Histórico */
const appInstalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

function htmlInstalar() {
  if (appInstalado()) return '';
  if (pedidoInstalacao) {
    return `<div class="pilha"><button class="btn btn-secundario btn-bloco" type="button" data-acao="instalar">${icone('baixar', 16)}Instalar na tela inicial</button></div>`;
  }
  if (ehIphone()) {
    return `<div class="alerta alerta-info"><p class="alerta-titulo">${icone('info', 16)}Para instalar, toque em Compartilhar no Safari e em Adicionar à Tela de Início.</p></div>`;
  }
  return '';
}

async function telaHistorico() {
  const versao = versaoRota;
  const atualId = await db.lerConfig('turnoAtualId');
  const turnos = (await db.todos('turnos')).sort((a, b) => b.criadoEm - a.criadoEm);
  const linhas = await Promise.all(
    turnos.map(async (t) => {
      const [itens, fotos] = await Promise.all([db.itensDoTurno(t.id), db.fotosDoTurno(t.id)]);
      const conteudo = formatoLista.format(partesContagem(itens, fotos)) || 'Sem inspeções';
      return `
        <a class="linha" href="#/relatorio/${t.id}">
          <span class="linha-textos">
            <span>${esc(cabecalho(t))}</span>
            <span class="nota">${esc(t.id === atualId ? `Em andamento, ${conteudo.toLowerCase()}` : conteudo)}</span>
          </span>
          ${icone('avancar', 16)}
        </a>`;
    }),
  );
  if (versao !== versaoRota) return;
  pintar(
    'historico',
    `<div class="tela">
      <header class="cabecalho"><h1 tabindex="-1">Histórico</h1></header>
      ${
        linhas.length
          ? `<div class="painel">${linhas.join('')}</div>`
          : htmlVazio({
              iconeNome: 'historico',
              titulo: 'Nenhum turno registrado',
              apoio: 'Os turnos encerrados ficam guardados aqui.',
              botao: '<a class="btn btn-secundario btn-md" href="#/turno/novo">Abrir turno</a>',
            })
      }
      ${htmlInstalar()}
    </div>`,
    { titulo: 'Histórico', aba: 'historico' },
  );
}

/* Dados do turno */
async function telaDadosTurno(modo) {
  const versao = versaoRota;
  turnoEmEdicao = modo === 'editar' ? await turnoAtual() : null;
  if (modo === 'editar' && !turnoEmEdicao) {
    location.replace('#/turno/novo');
    return;
  }
  const cliente = turnoEmEdicao?.cliente ?? ((await db.lerConfig('ultimoCliente')) || '');
  const equipe = turnoEmEdicao?.equipe ?? ((await db.lerConfig('ultimaEquipe')) || '');
  if (versao !== versaoRota) return;

  const titulo = turnoEmEdicao ? 'Dados do turno' : 'Novo turno';
  pintar(
    'dados-turno',
    `${barra(titulo)}
    <div class="tela">
      <form class="form" id="form-turno" novalidate>
        <div class="campo">
          <label class="campo-rotulo" for="t-cliente">Empresa (opcional)</label>
          <input class="entrada" id="t-cliente" type="text" value="${esc(cliente)}" autocomplete="organization" enterkeyhint="next" />
        </div>
        <div class="campo">
          <label class="campo-rotulo" for="t-data">Data *</label>
          <input class="entrada entrada-curta" id="t-data" type="date" value="${esc(turnoEmEdicao?.data ?? hojeIso())}" aria-required="true" aria-describedby="erro-data" />
          <p class="erro-campo" id="erro-data" hidden>Informe a data do turno para continuar.</p>
        </div>
        <div class="campo">
          <label class="campo-rotulo" for="t-equipe">Equipe (opcional)</label>
          <input class="entrada" id="t-equipe" type="text" value="${esc(equipe)}" autocomplete="off" enterkeyhint="done" />
        </div>
      </form>
    </div>`,
    {
      titulo,
      acao: `<button class="btn btn-primario btn-bloco" type="submit" form="form-turno">${turnoEmEdicao ? 'Salvar dados do turno' : 'Iniciar turno'}</button>`,
    },
  );
}

async function salvarDadosTurno() {
  const dados = { cliente: $('t-cliente').value.trim(), data: $('t-data').value, equipe: $('t-equipe').value.trim() };
  if (!dados.data) {
    $('erro-data').hidden = false;
    $('t-data').setAttribute('aria-invalid', 'true');
    document.title = `Erro: ${tituloAtual}`;
    $('t-data').focus();
    return;
  }
  await db.gravarConfig('ultimoCliente', dados.cliente);
  await db.gravarConfig('ultimaEquipe', dados.equipe);
  if (turnoEmEdicao) {
    await db.gravar('turnos', { ...turnoEmEdicao, ...dados });
    voltar();
    return;
  }
  const novo = { id: uid(), criadoEm: Date.now(), encerradoEm: null, ...dados };
  await db.gravar('turnos', novo);
  await db.gravarConfig('turnoAtualId', novo.id);
  location.replace('#/');
}

/* Aviso passageiro e confirmação */
function mostrarToast(mensagem, rotuloAcao, aoAgir) {
  clearTimeout(timerToast);
  elToast.innerHTML = `<span>${esc(mensagem)}</span>${rotuloAcao ? `<button class="toast-acao" type="button">${esc(rotuloAcao)}</button>` : ''}`;
  elToast.hidden = false;
  if (rotuloAcao) {
    elToast.querySelector('button').onclick = async () => {
      clearTimeout(timerToast);
      elToast.hidden = true;
      await aoAgir();
    };
  }
  timerToast = setTimeout(() => {
    elToast.hidden = true;
  }, rotuloAcao ? 8000 : 3000);
}

// Devolve 'sim', 'alternativa' ou 'nao'. O foco inicial fica fora da ação destrutiva (APP-30).
function confirmar({ titulo, texto, acao, estiloAcao = 'btn-perigo', alternativa, cancelar }) {
  return new Promise((resolver) => {
    dialogo.innerHTML = `
      <form method="dialog" class="dialogo-miolo">
        <h2>${esc(titulo)}</h2>
        <p>${esc(texto)}</p>
        <div class="dialogo-botoes">
          <button class="btn ${estiloAcao} btn-bloco" value="sim">${esc(acao)}</button>
          ${alternativa ? `<button class="btn btn-perigo btn-bloco" value="alternativa">${esc(alternativa)}</button>` : ''}
          <button class="btn btn-secundario btn-bloco" value="nao" autofocus>${esc(cancelar)}</button>
        </div>
      </form>`;
    dialogo.returnValue = 'nao';
    dialogo.addEventListener('close', () => resolver(dialogo.returnValue), { once: true });
    dialogo.showModal();
  });
}

dialogo.addEventListener('click', (evento) => {
  if (evento.target === dialogo) dialogo.close('nao');
});

/* Ações da tela */
const ACOES = {
  voltar: () => (telaAtual === 'formulario' ? sairDoFormulario() : voltar()),
  recarregar: () => location.reload(),
  tipo: (el) => {
    form.tipo = el.dataset.v;
    pintarEscolhas();
    salvarRascunho();
  },
  alternar: (el) => {
    form[el.dataset.campo] = !form[el.dataset.campo];
    pintarEscolhas();
    salvarRascunho();
  },
  'escolher-peca': (el) => {
    form.peca = el.dataset.v;
    $('f-peca').value = form.peca;
    limparErroPeca();
    pintarSugestoesPeca();
    salvarRascunho();
  },
  'escolher-of': (el) => {
    form.of = el.dataset.v;
    $('f-of').value = form.of;
    pintarSugestoesOf();
    salvarRascunho();
  },
  status: (el) => {
    form.status = form.status === el.dataset.v ? '' : el.dataset.v;
    pintarStatus();
    salvarRascunho();
  },
  'foto-camera': () => pedirFoto(inputCamera, form.id, form.turnoId),
  'foto-galeria': () => pedirFoto(inputGaleria, form.id, form.turnoId),
  'remover-foto': (el) => removerFoto(el.dataset.id),
  descartar: async () => {
    if (formAlterado()) {
      const escolha = await confirmar({
        titulo: 'Descartar esta inspeção?',
        texto: 'O que foi preenchido e as fotos desta inspeção serão perdidos.',
        acao: 'Descartar inspeção',
        cancelar: 'Continuar preenchendo',
      });
      if (escolha !== 'sim') return;
    }
    descartarFormulario();
  },
  'excluir-item': async () => {
    const f = form;
    form = null;
    limparRascunho();
    const copia = await db.excluirItem(f.id);
    copia.fotos.forEach((foto) => esquecerMiniatura(foto.id));
    voltar();
    mostrarToast('Inspeção excluída', 'Desfazer', async () => {
      await db.restaurarItem(copia);
      rotear();
    });
  },
  'card-foto': (el) => pedirFoto(inputGaleria, el.dataset.id, el.dataset.turno),
  'card-status': (el) => definirStatusDoCard(el.dataset.id, el.dataset.v),
  'enviar-texto': (el) => enviarTexto(el),
  'copiar-texto': (el) => copiarTexto(el),
  'enviar-lote': (el) => enviarLote(Number(el.dataset.lote)),
  'encerrar-turno': () => encerrarTurno(),
  'reabrir-turno': () => reabrirTurno(),
  'excluir-turno': () => excluirTurno(),
  instalar: async () => {
    if (!pedidoInstalacao) return;
    pedidoInstalacao.prompt();
    await pedidoInstalacao.userChoice;
    pedidoInstalacao = null;
    if (telaAtual === 'historico') telaHistorico();
  },
};

document.body.addEventListener('click', (evento) => {
  const el = evento.target.closest('[data-acao]');
  if (el) ACOES[el.dataset.acao]?.(el);
});
app.addEventListener('input', aoDigitar);
app.addEventListener('keydown', aoTeclar);
document.addEventListener('submit', (evento) => {
  if (evento.target.closest('dialog')) return;
  evento.preventDefault();
  if (evento.target.id === 'form-turno') salvarDadosTurno();
  else salvarFormulario();
});
inputCamera.addEventListener('change', aoEscolherFotos);
inputGaleria.addEventListener('change', aoEscolherFotos);
window.addEventListener('hashchange', () => {
  navegacoes += 1;
  rotear();
});
window.addEventListener('beforeinstallprompt', (evento) => {
  evento.preventDefault();
  pedidoInstalacao = evento;
  if (telaAtual === 'historico') telaHistorico();
});

// O rodapé muda de altura conforme a tela: conteúdo e aviso se posicionam por ele.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--dock-offset', `${dock.offsetHeight}px`);
}).observe(dock);

/* Início */
function iniciar() {
  navigator.storage?.persist?.().catch(() => {});
  // Se o celular fechou o app enquanto a câmera estava aberta, volta para o preenchimento.
  const rascunho = lerRascunho();
  if (rascunho && (!location.hash || location.hash === '#/')) history.replaceState(null, '', rascunho.hash);
  rotear();

  const emDesenvolvimento = ['localhost', '127.0.0.1'].includes(location.hostname) && !location.search.includes('sw=1');
  if ('serviceWorker' in navigator && !emDesenvolvimento) navigator.serviceWorker.register('sw.js');
}

iniciar();
