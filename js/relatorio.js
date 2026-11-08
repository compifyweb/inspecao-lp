// Regras do relatório. Só funções puras: sem tela e sem banco, para poder testar com node.

export const STATUS = [
  { valor: 'Aprovado', curto: 'Aprovado', cor: 'verde', icone: 'check' },
  { valor: 'Pendente', curto: 'Pendente', cor: 'amarelo', icone: 'relogio' },
  { valor: 'Aguardando reparo', curto: 'Ag. reparo', cor: 'laranja', icone: 'chave' },
];

// Status que pedem nova inspeção depois.
const COM_PROBLEMA = ['Pendente', 'Aguardando reparo'];

const formatoDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

export function dataCurta(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return formatoDia.format(new Date(ano, mes - 1, dia));
}

const formatoData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function dataCompleta(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return formatoData.format(new Date(ano, mes - 1, dia));
}

export function semAcento(texto) {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// "LP e revelado", "LPF revelado", "LPF 18:20", "Reinspeção LPF 18:40"
export function rotuloEtapa(item) {
  let base = item.tipo;
  if (item.penetracao && item.revelador) base = `${item.tipo} e revelado`;
  else if (item.revelador) base = `${item.tipo} revelado`;
  else if (item.penetracao) base = `${item.tipo} ${item.hora}`;
  return item.reinspecao ? `Reinspeção ${base}` : base;
}

export function descricaoPeca(item) {
  return item.qtd > 1 ? `${item.qtd} ${item.peca}` : item.peca;
}

export function textoOf(item) {
  return item.of ? `OF ${item.of}` : 'sem OF';
}

export function textoStatus(item) {
  if (!item.status) return '';
  const parcial =
    item.status === 'Pendente' && item.qtd > 1 && item.qtdPendente > 0 && item.qtdPendente < item.qtd;
  if (parcial) return item.qtdPendente === 1 ? '1 pendente' : `${item.qtdPendente} pendentes`;
  return item.status.toLowerCase();
}

export function linhaItem(item) {
  const status = textoStatus(item);
  const corpo = `- ${rotuloEtapa(item)} - ${descricaoPeca(item)} ${textoOf(item)}`;
  return status ? `${corpo} - ${status}` : corpo;
}

export function cabecalho(turno) {
  return [turno.cliente, dataCurta(turno.data), turno.equipe].filter(Boolean).join(' - ');
}

// A ordem é a de registro, nunca a da hora: o turno atravessa a meia-noite.
export function montarRelatorio(turno, itens) {
  const ordenados = [...itens].sort((a, b) => a.criadoEm - b.criadoEm);
  const linhas = ordenados.flatMap((item) =>
    item.obs ? [linhaItem(item), `  Obs: ${item.obs.replace(/\s+/g, ' ').trim()}`] : [linhaItem(item)],
  );
  return [cabecalho(turno), '', ...linhas].join('\n');
}

export function nomeArquivoPdf(turno) {
  const limpo = semAcento(['relatorio', turno.cliente, turno.data].filter(Boolean).join(' '))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${limpo}.pdf`;
}

// Atalho oferecido no card, conforme o que costuma vir depois nas anotações.
export function proximaAcao(item) {
  if (!item.status) return null;
  const problema = COM_PROBLEMA.includes(item.status);
  const parcial =
    item.status === 'Pendente' && item.qtd > 1 && item.qtdPendente > 0 && item.qtdPendente < item.qtd;
  if (item.tipo === 'LP' && (!problema || parcial)) return { acao: 'lpf', rotulo: 'Registrar LPF' };
  if (problema) return { acao: 'reinspecao', rotulo: 'Registrar reinspeção' };
  return null;
}

export function dadosProximaAcao(item, acao, hora) {
  const pendentes = Number(item.qtdPendente) || 0;
  const base = { peca: item.peca, of: item.of, hora, status: '', qtdPendente: null, obs: '' };
  if (acao === 'lpf') {
    // 23 tubos com 1 pendente: o LPF segue com os 22 que passaram.
    const qtd = item.qtd && pendentes ? item.qtd - pendentes : item.qtd;
    return { ...base, tipo: 'LPF', penetracao: true, revelador: false, reinspecao: false, qtd };
  }
  return { ...base, tipo: item.tipo, penetracao: item.penetracao, revelador: item.revelador, reinspecao: true, qtd: pendentes || item.qtd };
}

// Tempo de espera com o penetrante antes de revelar.
export const MINUTOS_PENETRANTE = { LP: 10, LPF: 180 };

// A contagem só vale enquanto a linha é só de penetrante e ainda não tem resultado.
export function fimDoPenetrante(item) {
  if (!item.penetranteEm || !item.penetracao || item.revelador || item.status) return null;
  return item.penetranteEm + MINUTOS_PENETRANTE[item.tipo] * 60000;
}

export function textoTempoRestante(ms) {
  const total = Math.ceil(ms / 1000);
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const dois = (n) => String(n).padStart(2, '0');
  return horas ? `${horas}:${dois(minutos)}:${dois(total % 60)}` : `${dois(minutos)}:${dois(total % 60)}`;
}

// Hora digitada no futuro é do dia anterior: o turno atravessa a meia-noite.
export function momentoDaHora(hora, agora = Date.now()) {
  const [horas, minutos] = hora.split(':').map(Number);
  const data = new Date(agora);
  data.setHours(horas, minutos, 0, 0);
  if (data.getTime() > agora + 60000) data.setDate(data.getDate() - 1);
  return data.getTime();
}

// Digitar 1234501 vira 12345-01. Aceita letra no final, como 12345-01B.
export function formatarOf(valor) {
  return valor
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^OF-?/, '')
    .replace(/^(\d{5})(?=[0-9A-Z])/, '$1-');
}
