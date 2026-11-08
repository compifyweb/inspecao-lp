// Tudo fica no próprio celular, em IndexedDB.

const NOME = 'inspecao-lp';
const VERSAO = 1;
let conexao;

function abrir() {
  if (!conexao) {
    conexao = new Promise((resolver, rejeitar) => {
      const pedido = indexedDB.open(NOME, VERSAO);
      pedido.onupgradeneeded = () => {
        const banco = pedido.result;
        banco.createObjectStore('turnos', { keyPath: 'id' });
        banco.createObjectStore('itens', { keyPath: 'id' }).createIndex('turnoId', 'turnoId');
        const fotos = banco.createObjectStore('fotos', { keyPath: 'id' });
        fotos.createIndex('itemId', 'itemId');
        fotos.createIndex('turnoId', 'turnoId');
        banco.createObjectStore('kv');
      };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
  }
  return conexao;
}

function promessa(pedido) {
  return new Promise((resolver, rejeitar) => {
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error);
  });
}

function fimDa(transacao) {
  return new Promise((resolver, rejeitar) => {
    transacao.oncomplete = () => resolver();
    transacao.onerror = () => rejeitar(transacao.error);
    transacao.onabort = () => rejeitar(transacao.error);
  });
}

async function loja(nome, modo = 'readonly') {
  return (await abrir()).transaction(nome, modo).objectStore(nome);
}

const porCriacao = (a, b) => a.criadoEm - b.criadoEm;

export const obter = async (nome, chave) => promessa((await loja(nome)).get(chave));
export const todos = async (nome) => promessa((await loja(nome)).getAll());
export const gravar = async (nome, valor) => promessa((await loja(nome, 'readwrite')).put(valor));
export const apagar = async (nome, chave) => promessa((await loja(nome, 'readwrite')).delete(chave));

export const lerConfig = async (chave) => promessa((await loja('kv')).get(chave));
export const gravarConfig = async (chave, valor) => promessa((await loja('kv', 'readwrite')).put(valor, chave));

async function porIndice(nome, indice, valor) {
  const lista = await promessa((await loja(nome)).index(indice).getAll(valor));
  return lista.sort(porCriacao);
}

export const itensDoTurno = (turnoId) => porIndice('itens', 'turnoId', turnoId);
export const fotosDoTurno = (turnoId) => porIndice('fotos', 'turnoId', turnoId);
export const fotosDoItem = (itemId) => porIndice('fotos', 'itemId', itemId);

// Devolve o que foi apagado, para o botão Desfazer.
export async function excluirItem(id) {
  const item = await obter('itens', id);
  const fotos = await fotosDoItem(id);
  const t = (await abrir()).transaction(['itens', 'fotos'], 'readwrite');
  t.objectStore('itens').delete(id);
  fotos.forEach((f) => t.objectStore('fotos').delete(f.id));
  await fimDa(t);
  return { item, fotos };
}

export async function restaurarItem({ item, fotos }) {
  const t = (await abrir()).transaction(['itens', 'fotos'], 'readwrite');
  if (item) t.objectStore('itens').put(item);
  fotos.forEach((f) => t.objectStore('fotos').put(f));
  await fimDa(t);
}

export async function excluirFotosDoItem(itemId) {
  const fotos = await fotosDoItem(itemId);
  const t = (await abrir()).transaction('fotos', 'readwrite');
  fotos.forEach((f) => t.objectStore('fotos').delete(f.id));
  await fimDa(t);
}

export async function excluirTurno(turnoId) {
  const [itens, fotos] = await Promise.all([itensDoTurno(turnoId), fotosDoTurno(turnoId)]);
  const t = (await abrir()).transaction(['turnos', 'itens', 'fotos'], 'readwrite');
  t.objectStore('turnos').delete(turnoId);
  itens.forEach((i) => t.objectStore('itens').delete(i.id));
  fotos.forEach((f) => t.objectStore('fotos').delete(f.id));
  await fimDa(t);
}
