// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback), the four languages of the Gladys interface.
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: widget contents, toasts, messages of the Configuration screen.
// Mails, event data and scene outputs carry no text of the integration (no
// `language` setting is needed).
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // connection status (Configuration screen)
  statusNoClient: {
    en: 'Enter the Client ID and Client secret of your Google Cloud OAuth client, save, then click Connect.',
    fr: 'Saisissez le Client ID et le Client secret de votre client OAuth Google Cloud, enregistrez, puis cliquez sur Connecter.',
    de: 'Gib Client-ID und Clientschlüssel deines Google-Cloud-OAuth-Clients ein, speichere und klicke dann auf Verbinden.',
    es: 'Introduce el Client ID y el Client secret de tu cliente OAuth de Google Cloud, guarda y pulsa Conectar.',
  },
  statusNotConnected: {
    en: 'Not connected: click "Connect with Google".',
    fr: 'Non connecté : cliquez sur « Se connecter avec Google ».',
    de: 'Nicht verbunden: Klicke auf „Mit Google verbinden“.',
    es: 'Sin conectar: pulsa «Conectar con Google».',
  },
  statusConnectedRead: {
    en: 'Connected to Gmail ({account}): {unread} unread mail(s) in the inbox.',
    fr: 'Connecté à Gmail ({account}) : {unread} mail(s) non lu(s) dans la boîte de réception.',
    de: 'Mit Gmail verbunden ({account}): {unread} ungelesene E-Mail(s) im Posteingang.',
    es: 'Conectado a Gmail ({account}): {unread} correo(s) sin leer en la bandeja de entrada.',
  },
  statusConnectedSend: {
    en: 'Connected to Gmail: sending and vacation responder (the mailbox is not read).',
    fr: 'Connecté à Gmail : envoi et réponse d’absence (la boîte n’est pas lue).',
    de: 'Mit Gmail verbunden: Senden und Abwesenheitsnotiz (das Postfach wird nicht gelesen).',
    es: 'Conectado a Gmail: envío y respuesta automática (el buzón no se lee).',
  },
  statusMissingScopes: {
    en: 'Connected, but Google did not grant every permission of the chosen access level: click "Connect with Google" again and tick every box.',
    fr: 'Connecté, mais Google n’a pas accordé toutes les autorisations du niveau d’accès choisi : recliquez sur « Se connecter avec Google » et cochez toutes les cases.',
    de: 'Verbunden, aber Google hat nicht alle Berechtigungen der gewählten Zugriffsstufe erteilt: Klicke erneut auf „Mit Google verbinden“ und setze alle Häkchen.',
    es: 'Conectado, pero Google no concedió todos los permisos del nivel de acceso elegido: vuelve a pulsar «Conectar con Google» y marca todas las casillas.',
  },
  statusReauth: {
    en: 'Google revoked the access (or the app is still in "Testing": 7 days). Click "Connect with Google" again.',
    fr: 'Google a révoqué l’accès (ou l’application est encore en « Test » : 7 jours). Cliquez à nouveau sur « Se connecter avec Google ».',
    de: 'Google hat den Zugriff widerrufen (oder die App ist noch im „Test“: 7 Tage). Klicke erneut auf „Mit Google verbinden“.',
    es: 'Google revocó el acceso (o la app sigue en «Prueba»: 7 días). Vuelve a pulsar «Conectar con Google».',
  },
  statusUnreachable: {
    en: 'Gmail unreachable, new try in a few minutes.',
    fr: 'Gmail injoignable, nouvel essai dans quelques minutes.',
    de: 'Gmail nicht erreichbar, neuer Versuch in ein paar Minuten.',
    es: 'Gmail inaccesible, nuevo intento en unos minutos.',
  },
  statusApiDisabled: {
    en: 'The Gmail API is not enabled in your Google Cloud project: enable it, then wait a few minutes.',
    fr: 'L’API Gmail n’est pas activée dans votre projet Google Cloud : activez-la, puis patientez quelques minutes.',
    de: 'Die Gmail API ist in deinem Google-Cloud-Projekt nicht aktiviert: Aktiviere sie und warte ein paar Minuten.',
    es: 'La API de Gmail no está activada en tu proyecto de Google Cloud: actívala y espera unos minutos.',
  },
  statusQuota: {
    en: 'Gmail quota reached: the readings resume later.',
    fr: 'Quota Gmail atteint : les lectures reprendront plus tard.',
    de: 'Gmail-Kontingent erreicht: Die Abfragen werden später fortgesetzt.',
    es: 'Cuota de Gmail alcanzada: las lecturas se reanudarán más tarde.',
  },
  connectState: {
    en: 'This Google answer does not match the last "Connect" click. Click it again, once, and keep only that tab.',
    fr: 'Cette réponse de Google ne correspond pas au dernier clic sur « Connecter ». Recliquez une seule fois et gardez uniquement cet onglet.',
    de: 'Diese Google-Antwort passt nicht zum letzten Klick auf „Verbinden“. Klicke erneut, nur einmal, und behalte nur diesen Tab.',
    es: 'Esta respuesta de Google no corresponde al último clic en «Conectar». Vuelve a pulsar una sola vez y conserva solo esa pestaña.',
  },
  connectScope: {
    en: 'No Gmail permission was granted. Click "Connect with Google" again and tick the Gmail boxes.',
    fr: 'Aucune autorisation Gmail n’a été accordée. Recliquez sur « Se connecter avec Google » et cochez les cases Gmail.',
    de: 'Es wurde keine Gmail-Berechtigung erteilt. Klicke erneut auf „Mit Google verbinden“ und setze die Gmail-Häkchen.',
    es: 'No se concedió ningún permiso de Gmail. Vuelve a pulsar «Conectar con Google» y marca las casillas de Gmail.',
  },
  connectFailed: {
    en: 'Google refused the connection ({reason}). Check the Client ID, the Client secret and the redirect URI, then try again.',
    fr: 'Google a refusé la connexion ({reason}). Vérifiez le Client ID, le Client secret et l’URI de redirection, puis réessayez.',
    de: 'Google hat die Verbindung abgelehnt ({reason}). Prüfe Client-ID, Clientschlüssel und Weiterleitungs-URI und versuche es erneut.',
    es: 'Google rechazó la conexión ({reason}). Comprueba el Client ID, el Client secret y el URI de redireccionamiento, y vuelve a intentarlo.',
  },

  // results of actions and toasts
  invalidAddress: {
    en: 'An email address is not valid.',
    fr: 'Une adresse e-mail n’est pas valide.',
    de: 'Eine E-Mail-Adresse ist ungültig.',
    es: 'Una dirección de correo no es válida.',
  },
  noRecipient: {
    en: 'The mail has no recipient.',
    fr: 'Le mail n’a aucun destinataire.',
    de: 'Die E-Mail hat keinen Empfänger.',
    es: 'El correo no tiene destinatario.',
  },
  emptyMail: {
    en: 'The mail is empty.',
    fr: 'Le mail est vide.',
    de: 'Die E-Mail ist leer.',
    es: 'El correo está vacío.',
  },
  invalidDate: {
    en: 'This date is not understood: use YYYY-MM-DD, DD/MM/YYYY (with an optional time) or +3.',
    fr: 'Date non comprise : utilisez AAAA-MM-JJ, JJ/MM/AAAA (heure facultative) ou +3.',
    de: 'Datum nicht verstanden: Verwende JJJJ-MM-TT, TT/MM/JJJJ (Uhrzeit optional) oder +3.',
    es: 'Fecha no entendida: usa AAAA-MM-DD, DD/MM/AAAA (hora opcional) o +3.',
  },
  endBeforeStart: {
    en: 'The end is before the start.',
    fr: 'La fin est avant le début.',
    de: 'Das Ende liegt vor dem Beginn.',
    es: 'El final es anterior al inicio.',
  },
  emptyVacation: {
    en: 'Enter a message for the automatic reply.',
    fr: 'Saisissez un message pour la réponse automatique.',
    de: 'Gib eine Nachricht für die automatische Antwort ein.',
    es: 'Escribe un mensaje para la respuesta automática.',
  },
  actionFailed: {
    en: 'Gmail did not accept the change: see the logs of the integration.',
    fr: 'Gmail n’a pas accepté la modification : voir les journaux de l’intégration.',
    de: 'Gmail hat die Änderung nicht angenommen: siehe Protokolle der Integration.',
    es: 'Gmail no aceptó el cambio: consulta los registros de la integración.',
  },
  notConnected: {
    en: 'Gmail is not connected: open the configuration of the integration.',
    fr: 'Gmail n’est pas connecté : ouvrez la configuration de l’intégration.',
    de: 'Gmail ist nicht verbunden: Öffne die Konfiguration der Integration.',
    es: 'Gmail no está conectado: abre la configuración de la integración.',
  },
  needsRead: {
    en: 'This widget reads your mailbox: choose a reading access level in the configuration, then connect again.',
    fr: 'Ce widget lit votre boîte : choisissez un niveau d’accès en lecture dans la configuration, puis reconnectez-vous.',
    de: 'Dieses Widget liest dein Postfach: Wähle in der Konfiguration eine Zugriffsstufe mit Lesen und verbinde dich erneut.',
    es: 'Este widget lee tu buzón: elige un nivel de acceso con lectura en la configuración y vuelve a conectarte.',
  },
  needsModify: {
    en: 'Marking as read needs the "Read and organize" access level.',
    fr: 'Marquer comme lu demande le niveau d’accès « Lire et organiser ».',
    de: 'Als gelesen markieren erfordert die Zugriffsstufe „Lesen und organisieren“.',
    es: 'Marcar como leído requiere el nivel de acceso «Leer y organizar».',
  },
  needsSettings: {
    en: 'Google did not grant the vacation responder permission: connect again and tick it.',
    fr: 'Google n’a pas accordé l’autorisation de la réponse d’absence : reconnectez-vous et cochez-la.',
    de: 'Google hat die Berechtigung für die Abwesenheitsnotiz nicht erteilt: Verbinde dich erneut und setze das Häkchen.',
    es: 'Google no concedió el permiso de la respuesta automática: vuelve a conectarte y márcalo.',
  },
  unknownLabel: {
    en: 'No Gmail label is named "{label}": type it as shown in Gmail.',
    fr: 'Aucun libellé Gmail ne s’appelle « {label} » : saisissez-le comme dans Gmail.',
    de: 'Kein Gmail-Label heißt „{label}“: Gib es so ein, wie es in Gmail steht.',
    es: 'Ninguna etiqueta de Gmail se llama «{label}»: escríbela como aparece en Gmail.',
  },
  refreshDone: {
    en: 'Gmail read again.',
    fr: 'Gmail relu.',
    de: 'Gmail neu gelesen.',
    es: 'Gmail leído de nuevo.',
  },
  refreshFailed: {
    en: 'Gmail could not be read.',
    fr: 'Impossible de lire Gmail.',
    de: 'Gmail konnte nicht gelesen werden.',
    es: 'No se pudo leer Gmail.',
  },
  markedRead: {
    en: '{count} mail(s) marked as read.',
    fr: '{count} mail(s) marqué(s) comme lu(s).',
    de: '{count} E-Mail(s) als gelesen markiert.',
    es: '{count} correo(s) marcado(s) como leído(s).',
  },
  vacationOnDone: {
    en: 'Vacation responder on, until you turn it off.',
    fr: 'Réponse d’absence activée, jusqu’à ce que vous la désactiviez.',
    de: 'Abwesenheitsnotiz aktiviert, bis du sie ausschaltest.',
    es: 'Respuesta automática activada hasta que la desactives.',
  },
  vacationOnUntil: {
    en: 'Vacation responder on for {days} day(s).',
    fr: 'Réponse d’absence activée pour {days} jour(s).',
    de: 'Abwesenheitsnotiz für {days} Tag(e) aktiviert.',
    es: 'Respuesta automática activada durante {days} día(s).',
  },
  vacationOffDone: {
    en: 'Vacation responder off.',
    fr: 'Réponse d’absence désactivée.',
    de: 'Abwesenheitsnotiz ausgeschaltet.',
    es: 'Respuesta automática desactivada.',
  },
  testResult: {
    en: 'Connected to {account}. Allowed: {allowed}. Gmail quota used today: {units} units.',
    fr: 'Connecté à {account}. Autorisé : {allowed}. Quota Gmail utilisé aujourd’hui : {units} unités.',
    de: 'Verbunden mit {account}. Erlaubt: {allowed}. Heute genutztes Gmail-Kontingent: {units} Einheiten.',
    es: 'Conectado a {account}. Permitido: {allowed}. Cuota de Gmail usada hoy: {units} unidades.',
  },
  accountHidden: {
    en: 'your account',
    fr: 'votre compte',
    de: 'dein Konto',
    es: 'tu cuenta',
  },
  can_send: { en: 'send', fr: 'envoi', de: 'Senden', es: 'envío' },
  can_settings: {
    en: 'vacation responder',
    fr: 'réponse d’absence',
    de: 'Abwesenheitsnotiz',
    es: 'respuesta automática',
  },
  can_read: { en: 'reading', fr: 'lecture', de: 'Lesen', es: 'lectura' },
  can_modify: { en: 'organizing', fr: 'organisation', de: 'Organisieren', es: 'organización' },
  diagnosticDone: {
    en: 'Diagnostic written to the logs of the integration (Settings → Supervision): no token, no address, no mail content.',
    fr: 'Diagnostic écrit dans les journaux de l’intégration (Paramètres → Supervision) : aucun jeton, aucune adresse, aucun contenu de mail.',
    de: 'Diagnose in die Protokolle der Integration geschrieben (Einstellungen → Überwachung): kein Token, keine Adresse, kein E-Mail-Inhalt.',
    es: 'Diagnóstico escrito en los registros de la integración (Ajustes → Supervisión): sin tokens, sin direcciones, sin contenido de correos.',
  },
  disconnected: {
    en: 'Disconnected: the access of Gladys was revoked at Google and the tokens deleted.',
    fr: 'Déconnecté : l’accès de Gladys a été révoqué chez Google et les jetons supprimés.',
    de: 'Getrennt: Der Zugriff von Gladys wurde bei Google widerrufen und die Token gelöscht.',
    es: 'Desconectado: el acceso de Gladys se revocó en Google y los tokens se borraron.',
  },

  // widgets
  buttonRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  inbox: {
    en: 'Inbox',
    fr: 'Boîte de réception',
    de: 'Posteingang',
    es: 'Recibidos',
  },
  tileUnread: { en: 'Unread', fr: 'Non lus', de: 'Ungelesen', es: 'Sin leer' },
  noSubject: { en: '(no subject)', fr: '(sans objet)', de: '(kein Betreff)', es: '(sin asunto)' },
  badgeImportant: { en: 'Important', fr: 'Important', de: 'Wichtig', es: 'Importante' },
  openMail: {
    en: 'Open in Gmail',
    fr: 'Ouvrir dans Gmail',
    de: 'In Gmail öffnen',
    es: 'Abrir en Gmail',
  },
  moreMails: {
    en: 'And {count} more unread.',
    fr: 'Et {count} autre(s) non lu(s).',
    de: 'Und {count} weitere ungelesene.',
    es: 'Y {count} más sin leer.',
  },
  noUnread: {
    en: 'No unread mail.',
    fr: 'Aucun mail non lu.',
    de: 'Keine ungelesene E-Mail.',
    es: 'Ningún correo sin leer.',
  },
  buttonMarkRead: {
    en: 'Mark as read',
    fr: 'Marquer comme lus',
    de: 'Als gelesen markieren',
    es: 'Marcar como leídos',
  },
  buttonOpenGmail: { en: 'Open Gmail', fr: 'Ouvrir Gmail', de: 'Gmail öffnen', es: 'Abrir Gmail' },
  buttonVacationOn: { en: 'Turn on', fr: 'Activer', de: 'Einschalten', es: 'Activar' },
  buttonVacationOff: { en: 'Turn off', fr: 'Désactiver', de: 'Ausschalten', es: 'Desactivar' },
  fieldSubject: { en: 'Subject', fr: 'Objet', de: 'Betreff', es: 'Asunto' },
  fieldSubjectPlaceholder: {
    en: 'Out of office',
    fr: 'Absent du bureau',
    de: 'Nicht im Büro',
    es: 'Fuera de la oficina',
  },
  fieldMessage: { en: 'Message', fr: 'Message', de: 'Nachricht', es: 'Mensaje' },
  fieldMessagePlaceholder: {
    en: 'I am away, back on Monday.',
    fr: 'Je suis absent, de retour lundi.',
    de: 'Ich bin bis Montag abwesend.',
    es: 'Estoy fuera, vuelvo el lunes.',
  },
  fieldDays: { en: 'For (days)', fr: 'Pendant (jours)', de: 'Für (Tage)', es: 'Durante (días)' },
  fieldDaysDescription: {
    en: '0 = until you turn it off.',
    fr: '0 = jusqu’à désactivation.',
    de: '0 = bis zum Ausschalten.',
    es: '0 = hasta que la desactives.',
  },
  fieldContactsOnly: {
    en: 'Only reply to my contacts',
    fr: 'Ne répondre qu’à mes contacts',
    de: 'Nur meinen Kontakten antworten',
    es: 'Responder solo a mis contactos',
  },
  rowState: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  vacationOn: { en: 'On', fr: 'Activée', de: 'Aktiv', es: 'Activada' },
  vacationOff: { en: 'Off', fr: 'Désactivée', de: 'Aus', es: 'Desactivada' },
  vacationScheduled: { en: 'Scheduled', fr: 'Programmée', de: 'Geplant', es: 'Programada' },
  vacationExpired: { en: 'Ended', fr: 'Terminée', de: 'Beendet', es: 'Terminada' },
  rowSubject: { en: 'Subject', fr: 'Objet', de: 'Betreff', es: 'Asunto' },
  rowFrom: { en: 'From', fr: 'Du', de: 'Ab', es: 'Desde' },
  rowUntil: { en: 'Until', fr: 'Jusqu’au', de: 'Bis', es: 'Hasta' },
  untilOff: {
    en: 'Turned off by hand',
    fr: 'Désactivation manuelle',
    de: 'Manuelles Ausschalten',
    es: 'Desactivación manual',
  },
  rowRecipients: { en: 'Replies to', fr: 'Répond à', de: 'Antwortet', es: 'Responde a' },
  recipientsContacts: {
    en: 'My contacts',
    fr: 'Mes contacts',
    de: 'Meinen Kontakten',
    es: 'Mis contactos',
  },
  recipientsEveryone: { en: 'Everyone', fr: 'Tout le monde', de: 'Allen', es: 'Todos' },
};

/**
 * @description A text in a language, with `{name}` substitutions.
 * @param {string} key - The TEXTS key.
 * @param {string} language - The language.
 * @param {object} [values] - The substitutions.
 * @returns {string} The text.
 * @example
 * t('markedRead', 'fr', { count: 2 }); // -> '2 mail(s) marqué(s) comme lu(s).'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const text = entry[language] ?? entry.en;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined || values[name] === null ? match : String(values[name]),
  );
}

/**
 * @description A text built per language, at most 200 characters (toasts and
 * connection messages are cut there by Gladys).
 * @param {Function} build - `(language) => string`.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function each(build) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const text = build(language);
      return [language, text.length > 200 ? `${text.slice(0, 199)}…` : text];
    }),
  );
}

/**
 * @description The text of a key in every language.
 * @param {string} key - The TEXTS key.
 * @param {object} [values] - The substitutions.
 * @returns {{ en: string, fr: string, de: string, es: string }} The message.
 */
function all(key, values = {}) {
  return each((language) => t(key, language, values));
}

export { LANGUAGES, TEXTS, t, all, each };
