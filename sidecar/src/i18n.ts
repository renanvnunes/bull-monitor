// Mensagens que o sidecar devolve para a interface (erros de validação, importação etc.).
// Os textos da tela inicial ficam em public/i18n.js. Os dois usam os códigos de idioma do
// bull-board, então o mesmo idioma vale para a tela inicial e para as boards.

export const LANGUAGES = [
  'en-US', 'en-GB', 'da-DK', 'de-DE', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU', 'tr-TR', 'zh-CN',
] as const;
export type Language = (typeof LANGUAGES)[number];

/** Inglês até o usuário escolher outro idioma. */
export const DEFAULT_LANGUAGE: Language = 'en-US';

export const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language);

/** Códigos usados antes de seguir os do bull-board. */
const LEGACY: Record<string, Language> = { en: 'en-US', es: 'es-ES' };

/** Idioma salvo, convertendo códigos antigos; desconhecido volta ao padrão. */
export function parseLanguage(value: unknown): Language {
  if (isLanguage(value)) return value;
  return LEGACY[String(value)] ?? DEFAULT_LANGUAGE;
}

const en = {
  nameRequired: 'Enter a name for the server.',
  invalidUrl: 'Invalid URL. Example: redis://user:password@host:6379/0',
  invalidProtocol: 'The URL must start with redis:// or rediss:// (TLS).',
  wildcardPrefix: 'Prefixes with * are not supported. List them separated by commas.',
  passwordTooShort: 'The password must be at least {min} characters long.',
  passwordRequired: 'Enter the file password.',
  unsupportedFile: 'File from another version or corrupted.',
  wrongPassword: 'Wrong password or corrupted file.',
  noServerList: 'Invalid file: there is no "servers" list.',
  invalidConnection: 'Connection {name}: {error}',
  serverNotFound: 'Server not found.',
  redisTimeout: 'Timed out while querying Redis.',
  boardClosed: 'The board was closed before it finished opening.',
  openFailed: 'Could not open <b>{name}</b>: {error}',
  back: 'Back',
  servers: 'Servers',
  // Só ASCII: vai no cabeçalho Content-Disposition.
  exportFile: 'bull-monitor-connections-{date}.json',
};

export type MessageKey = keyof typeof en;

/** Chaves que faltam caem no inglês. */
const messages: Record<Language, Partial<Record<MessageKey, string>>> = {
  'en-US': en,
  'en-GB': {},
  'da-DK': {
    nameRequired: 'Angiv et navn til serveren.',
    invalidUrl: 'Ugyldig URL. Eksempel: redis://bruger:adgangskode@host:6379/0',
    invalidProtocol: 'URL’en skal starte med redis:// eller rediss:// (TLS).',
    wildcardPrefix: 'Præfikser med * understøttes ikke. Angiv dem adskilt af kommaer.',
    passwordTooShort: 'Adgangskoden skal være på mindst {min} tegn.',
    passwordRequired: 'Angiv filens adgangskode.',
    unsupportedFile: 'Filen er fra en anden version eller er beskadiget.',
    wrongPassword: 'Forkert adgangskode eller beskadiget fil.',
    noServerList: 'Ugyldig fil: der er ingen "servers"-liste.',
    invalidConnection: 'Forbindelse {name}: {error}',
    serverNotFound: 'Serveren blev ikke fundet.',
    redisTimeout: 'Tidsgrænsen blev overskredet under forespørgslen til Redis.',
    boardClosed: 'Boardet blev lukket, før det var færdigt med at åbne.',
    openFailed: 'Kunne ikke åbne <b>{name}</b>: {error}',
    back: 'Tilbage',
    servers: 'Servere',
    exportFile: 'bull-monitor-forbindelser-{date}.json',
  },
  'de-DE': {
    nameRequired: 'Gib einen Namen für den Server ein.',
    invalidUrl: 'Ungültige URL. Beispiel: redis://benutzer:passwort@host:6379/0',
    invalidProtocol: 'Die URL muss mit redis:// oder rediss:// (TLS) beginnen.',
    wildcardPrefix: 'Präfixe mit * werden nicht unterstützt. Gib sie durch Kommas getrennt an.',
    passwordTooShort: 'Das Passwort muss mindestens {min} Zeichen lang sein.',
    passwordRequired: 'Gib das Passwort der Datei ein.',
    unsupportedFile: 'Datei aus einer anderen Version oder beschädigt.',
    wrongPassword: 'Falsches Passwort oder beschädigte Datei.',
    noServerList: 'Ungültige Datei: Es gibt keine Liste "servers".',
    invalidConnection: 'Verbindung {name}: {error}',
    serverNotFound: 'Server nicht gefunden.',
    redisTimeout: 'Zeitüberschreitung bei der Abfrage von Redis.',
    boardClosed: 'Das Board wurde geschlossen, bevor es fertig geöffnet war.',
    openFailed: '<b>{name}</b> konnte nicht geöffnet werden: {error}',
    back: 'Zurück',
    servers: 'Server',
    exportFile: 'bull-monitor-verbindungen-{date}.json',
  },
  'es-ES': {
    nameRequired: 'Introduce un nombre para el servidor.',
    invalidUrl: 'URL no válida. Ejemplo: redis://usuario:contraseña@host:6379/0',
    invalidProtocol: 'La URL debe empezar por redis:// o rediss:// (TLS).',
    wildcardPrefix: 'No se admiten prefijos con *. Indícalos separados por comas.',
    passwordTooShort: 'La contraseña debe tener al menos {min} caracteres.',
    passwordRequired: 'Introduce la contraseña del archivo.',
    unsupportedFile: 'Archivo de otra versión o dañado.',
    wrongPassword: 'Contraseña incorrecta o archivo dañado.',
    noServerList: 'Archivo no válido: no hay una lista "servers".',
    invalidConnection: 'Conexión {name}: {error}',
    serverNotFound: 'Servidor no encontrado.',
    redisTimeout: 'Se agotó el tiempo al consultar Redis.',
    boardClosed: 'El tablero se cerró antes de terminar de abrirse.',
    openFailed: 'No se pudo abrir <b>{name}</b>: {error}',
    back: 'Volver',
    servers: 'Servidores',
    exportFile: 'bull-monitor-conexiones-{date}.json',
  },
  'fr-FR': {
    nameRequired: 'Indiquez un nom pour le serveur.',
    invalidUrl: 'URL invalide. Exemple : redis://utilisateur:motdepasse@host:6379/0',
    invalidProtocol: 'L’URL doit commencer par redis:// ou rediss:// (TLS).',
    wildcardPrefix: 'Les préfixes contenant * ne sont pas pris en charge. Séparez-les par des virgules.',
    passwordTooShort: 'Le mot de passe doit contenir au moins {min} caractères.',
    passwordRequired: 'Saisissez le mot de passe du fichier.',
    unsupportedFile: 'Fichier d’une autre version ou corrompu.',
    wrongPassword: 'Mot de passe incorrect ou fichier corrompu.',
    noServerList: 'Fichier invalide : il n’y a pas de liste « servers ».',
    invalidConnection: 'Connexion {name} : {error}',
    serverNotFound: 'Serveur introuvable.',
    redisTimeout: 'Délai dépassé lors de l’interrogation de Redis.',
    boardClosed: 'Le tableau a été fermé avant la fin de son ouverture.',
    openFailed: 'Impossible d’ouvrir <b>{name}</b> : {error}',
    back: 'Retour',
    servers: 'Serveurs',
    exportFile: 'bull-monitor-connexions-{date}.json',
  },
  'ja-JP': {
    nameRequired: 'サーバーの名前を入力してください。',
    invalidUrl: '無効な URL です。例: redis://user:password@host:6379/0',
    invalidProtocol: 'URL は redis:// または rediss://（TLS）で始まる必要があります。',
    wildcardPrefix: '* を含むプレフィックスはサポートされていません。カンマ区切りで指定してください。',
    passwordTooShort: 'パスワードは {min} 文字以上にしてください。',
    passwordRequired: 'ファイルのパスワードを入力してください。',
    unsupportedFile: '別のバージョンのファイルか、ファイルが破損しています。',
    wrongPassword: 'パスワードが正しくないか、ファイルが破損しています。',
    noServerList: '無効なファイルです: "servers" リストがありません。',
    invalidConnection: '接続 {name}: {error}',
    serverNotFound: 'サーバーが見つかりません。',
    redisTimeout: 'Redis への問い合わせがタイムアウトしました。',
    boardClosed: 'ボードは開き終わる前に閉じられました。',
    openFailed: '<b>{name}</b> を開けませんでした: {error}',
    back: '戻る',
    servers: 'サーバー',
  },
  'ko-KR': {
    nameRequired: '서버 이름을 입력하세요.',
    invalidUrl: '잘못된 URL입니다. 예: redis://user:password@host:6379/0',
    invalidProtocol: 'URL은 redis:// 또는 rediss://(TLS)로 시작해야 합니다.',
    wildcardPrefix: '*가 포함된 접두사는 지원되지 않습니다. 쉼표로 구분해 입력하세요.',
    passwordTooShort: '비밀번호는 {min}자 이상이어야 합니다.',
    passwordRequired: '파일 비밀번호를 입력하세요.',
    unsupportedFile: '다른 버전의 파일이거나 손상된 파일입니다.',
    wrongPassword: '비밀번호가 틀렸거나 파일이 손상되었습니다.',
    noServerList: '잘못된 파일입니다: "servers" 목록이 없습니다.',
    invalidConnection: '연결 {name}: {error}',
    serverNotFound: '서버를 찾을 수 없습니다.',
    redisTimeout: 'Redis 조회 시간이 초과되었습니다.',
    boardClosed: '보드가 다 열리기 전에 닫혔습니다.',
    openFailed: '<b>{name}</b>을(를) 열 수 없습니다: {error}',
    back: '뒤로',
    servers: '서버',
  },
  'pt-BR': {
    nameRequired: 'Informe um nome para o servidor.',
    invalidUrl: 'URL inválida. Exemplo: redis://usuario:senha@host:6379/0',
    invalidProtocol: 'A URL deve começar com redis:// ou rediss:// (TLS).',
    wildcardPrefix: 'Prefixos com * não são suportados. Liste-os separados por vírgula.',
    passwordTooShort: 'A senha precisa ter pelo menos {min} caracteres.',
    passwordRequired: 'Informe a senha do arquivo.',
    unsupportedFile: 'Arquivo de outra versão ou corrompido.',
    wrongPassword: 'Senha incorreta ou arquivo corrompido.',
    noServerList: 'Arquivo inválido: não há uma lista "servers".',
    invalidConnection: 'Conexão {name}: {error}',
    serverNotFound: 'Servidor não encontrado.',
    redisTimeout: 'Tempo esgotado ao consultar o Redis.',
    boardClosed: 'A board foi fechada antes de terminar de abrir.',
    openFailed: 'Não foi possível abrir <b>{name}</b>: {error}',
    back: 'Voltar',
    servers: 'Servidores',
    exportFile: 'bull-monitor-conexoes-{date}.json',
  },
  'ru-RU': {
    nameRequired: 'Укажите имя сервера.',
    invalidUrl: 'Неверный URL. Пример: redis://user:password@host:6379/0',
    invalidProtocol: 'URL должен начинаться с redis:// или rediss:// (TLS).',
    wildcardPrefix: 'Префиксы с * не поддерживаются. Перечислите их через запятую.',
    passwordTooShort: 'Пароль должен содержать не менее {min} символов.',
    passwordRequired: 'Введите пароль файла.',
    unsupportedFile: 'Файл другой версии или повреждён.',
    wrongPassword: 'Неверный пароль или файл повреждён.',
    noServerList: 'Неверный файл: нет списка "servers".',
    invalidConnection: 'Подключение {name}: {error}',
    serverNotFound: 'Сервер не найден.',
    redisTimeout: 'Истекло время ожидания ответа от Redis.',
    boardClosed: 'Панель была закрыта до того, как успела открыться.',
    openFailed: 'Не удалось открыть <b>{name}</b>: {error}',
    back: 'Назад',
    servers: 'Серверы',
  },
  'tr-TR': {
    nameRequired: 'Sunucu için bir ad girin.',
    invalidUrl: 'Geçersiz URL. Örnek: redis://kullanici:parola@host:6379/0',
    invalidProtocol: 'URL, redis:// veya rediss:// (TLS) ile başlamalıdır.',
    wildcardPrefix: '* içeren önekler desteklenmiyor. Virgülle ayırarak yazın.',
    passwordTooShort: 'Parola en az {min} karakter olmalıdır.',
    passwordRequired: 'Dosyanın parolasını girin.',
    unsupportedFile: 'Dosya başka bir sürüme ait veya bozuk.',
    wrongPassword: 'Parola yanlış veya dosya bozuk.',
    noServerList: 'Geçersiz dosya: "servers" listesi yok.',
    invalidConnection: 'Bağlantı {name}: {error}',
    serverNotFound: 'Sunucu bulunamadı.',
    redisTimeout: 'Redis sorgulanırken zaman aşımı oluştu.',
    boardClosed: 'Pano, açılması tamamlanmadan kapatıldı.',
    openFailed: '<b>{name}</b> açılamadı: {error}',
    back: 'Geri',
    servers: 'Sunucular',
    exportFile: 'bull-monitor-baglantilar-{date}.json',
  },
  'zh-CN': {
    nameRequired: '请输入服务器名称。',
    invalidUrl: 'URL 无效。示例：redis://user:password@host:6379/0',
    invalidProtocol: 'URL 必须以 redis:// 或 rediss://（TLS）开头。',
    wildcardPrefix: '不支持包含 * 的前缀。请用逗号分隔列出。',
    passwordTooShort: '密码至少需要 {min} 个字符。',
    passwordRequired: '请输入文件密码。',
    unsupportedFile: '文件来自其他版本或已损坏。',
    wrongPassword: '密码错误或文件已损坏。',
    noServerList: '文件无效：没有 "servers" 列表。',
    invalidConnection: '连接 {name}：{error}',
    serverNotFound: '未找到服务器。',
    redisTimeout: '查询 Redis 超时。',
    boardClosed: '看板在打开完成前已被关闭。',
    openFailed: '无法打开 <b>{name}</b>：{error}',
    back: '返回',
    servers: '服务器',
  },
};

let current: Language = DEFAULT_LANGUAGE;

export const getLanguage = () => current;
export const setLanguage = (language: Language) => (current = language);

/** Mensagem no idioma atual, com `{nome}` trocado pelos valores de `params`. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const text = messages[current][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}
