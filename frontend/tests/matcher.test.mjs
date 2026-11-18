import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { match, normalize, scoreChoices } from "../js/matcher.js";

const load = (lang) => JSON.parse(readFileSync(new URL(`../data/scenarios.${lang}.json`, import.meta.url), "utf8"));
const DATA = { en: load("en"), es: load("es"), fr: load("fr") };
const data = DATA.en;
const node = (sid, nid, lang = "en") => DATA[lang].scenarios.find((s) => s.id === sid).nodes[nid];

// [scenario, node, choiceId, phrases]. At least 6 per choice, including Nigerian English.
const EN_CASES = [
  ["bank-call", "n1", "c1", [
    "My date of birth is the fifth of May",
    "I was born on 12 March 1985",
    "Okay sure, it's nineteen eighty",
    "Ehn, my birthday is 3rd of June",
    "Oga no wahala, I was born in July",
    "my dob is 4 april",
  ]],
  ["bank-call", "n1", "c2", [
    "Why are you calling me?",
    "Who is this please?",
    "Sorry, who are you?",
    "Wetin happen to my account?",
    "What is happening with my account?",
    "Flagged for what? Tell me why",
    "Who be this?",
  ]],
  ["bank-call", "n1", "c3", [
    "I will hang up and call the bank",
    "Let me call the number on my card",
    "I'll call you back",
    "Abeg, I will verify with the bank myself. Bye",
    "I will go to the bank tomorrow",
    "No I will not, I will call back",
  ]],
  ["bank-call", "n2", "c1", [
    "The code is 4 8 2 9 1 7",
    "Okay here is the code",
    "Ehn, I see the code, it says 551203",
    "I have the code now",
    "Ok I will read it to you",
    "Let me read it, the code says 7711",
  ]],
  ["bank-call", "n2", "c2", [
    "Banks never ask for codes, I'm hanging up. Bye",
    "My bank never asks for that. I will hang up",
    "This is a scam, I am not giving you anything",
    "You be scammer, 419! Bye",
    "I will call the bank with the number on my card",
    "I know this trick. Hang up.",
  ]],
  ["bank-call", "n2", "c3", [
    "What is your staff ID?",
    "Give me your staff number first",
    "Prove it, what is your ID number?",
    "Which branch are you from? Your full name?",
    "Oga, show me your badge, prove it",
    "Tell me your staff id",
  ]],
  ["bank-call", "n3", "c1", [
    "Okay okay, the code is 3 3 9 1 0 2",
    "Here is the code",
    "Alright, I have the code",
    "Abeg take the code, it says 884210",
    "Ok I will read it to you now",
    "I see the code",
  ]],
  ["bank-call", "n3", "c2", [
    "I'm going to hang up and call the bank",
    "I will call the bank on my own",
    "I'll go to the bank myself",
    "You are a scammer, bye",
    "I will verify with the number on my card",
    "Abeg I will call back",
  ]],
  ["family-voice", "n1", "c1", [
    "Okay I am sending it now",
    "I will send the money, what account?",
    "Give me the account number",
    "Ok my son, I'm sending it",
    "Ok sending",
    "I will transfer it now",
  ]],
  ["family-voice", "n1", "c2", [
    "What is our family code word?",
    "Tell me the code word first",
    "Say the word, our secret word",
    "Prove it is you, what's our password?",
    "If it is you, tell me our code",
    "Biko, what is our family code?",
  ]],
  ["family-voice", "n1", "c3", [
    "I'll hang up and call your real number",
    "Let me call Chidi on his normal number",
    "I will call you back on your number",
    "I'm going to call your phone",
    "Hang up, I will call you",
    "Let me call him. Bye",
  ]],
  ["family-voice", "n2", "c1", [
    "Okay I will send it",
    "I'm sending the money now",
    "I will pay the hospital",
    "Give me the account number, I will help you",
    "Ok my dear, I have sent it",
    "I am sending it now",
  ]],
  ["family-voice", "n2", "c2", [
    "I'll hang up and call your real number",
    "Let me call Chidi",
    "I will call you back on your normal number",
    "I'm going to hang up now",
    "I will call your phone",
    "Let me call him first",
  ]],
  ["family-voice", "n2", "c3", [
    "Where are you?",
    "Which hospital are you in?",
    "Tell me where you are",
    "Where you dey?",
    "What is the name of the hospital?",
    "What is the address?",
  ]],
  ["family-voice", "n3", "c1", [
    "Okay I am sending it",
    "I will send it now",
    "Ok my son, I'm sending",
    "I have sent it",
    "Give me the account number",
    "I will transfer it",
  ]],
  ["family-voice", "n3", "c2", [
    "I will hang up and call your real number",
    "I'm going to call Chidi",
    "Let me call your father",
    "I'll call you back",
    "I will call your phone now. Bye",
    "Hang up, I am calling Daddy",
  ]],
  ["pos-alert", "n1", "c1", [
    "Okay, here is the cash",
    "Oya take your money",
    "Here you go, count it",
    "Ok take the cash",
    "Come and collect it",
    "Let me give you the money, here you go",
  ]],
  ["pos-alert", "n1", "c2", [
    "Let me check my app first",
    "I will check my banking app, not the SMS",
    "I need to check my balance",
    "The message is not enough, let me check my account",
    "Abeg let me confirm on the app",
    "I will check my bank app",
  ]],
  ["pos-alert", "n1", "c3", [
    "Please wait",
    "Hold on, give me a minute",
    "Oga, wait small",
    "Exercise patience",
    "Calm down, no rush",
    "Relax, take it easy",
  ]],
  ["pos-alert", "n2", "c1", [
    "Okay, here is the cash",
    "Oya take your money",
    "Here you go",
    "Ok take the cash",
    "Let me give you your money",
    "Here is your money, count it",
  ]],
  ["pos-alert", "n2", "c2", [
    "I will wait until my app shows it",
    "Not until it enters my own app",
    "Wait until I see it in my balance",
    "When it shows in my banking app I will pay",
    "I will check my app",
    "Until I see it on my own app, no cash",
  ]],
  ["pos-alert", "n3", "c1", [
    "Okay, here is the cash",
    "Oya take your money",
    "Here you go",
    "Ok take the cash",
    "Let me give you the money",
    "Here is your money",
  ]],
  ["pos-alert", "n3", "c2", [
    "Let me check my banking app first",
    "I will check my own app",
    "Let me check my balance first",
    "I need to confirm on the app",
    "Abeg I will check my account",
    "First, I will check my bank app",
  ]],
];

const ES_CASES = [
  ["bank-call", "n1", "c1", ["Mi fecha de nacimiento es el 5 de mayo", "Nací el 12 de marzo de 1985", "De acuerdo, mi cumpleaños es en junio", "Claro que sí, nací en julio", "Mi fecha de nacimiento es el 3 de agosto", "Nací en diciembre"]],
  ["bank-call", "n1", "c2", ["¿Por qué me llama?", "¿Quién habla?", "¿Quién es usted?", "¿Qué pasa con mi cuenta?", "¿De qué se trata esto?", "Explíqueme, ¿qué actividad?"]],
  ["bank-call", "n1", "c3", ["Voy a colgar y llamar al banco", "Cuelgo y llamo al número de mi tarjeta", "Verifico con mi banco, adiós", "Lo llamo después", "Voy a la sucursal mañana", "Llamaré al banco yo misma"]],
  ["bank-call", "n2", "c1", ["El código es 4 8 2 9 1 7", "Aquí está el código", "Ya tengo el código", "Se lo leo: 551203", "Me llegó el código, los números son 7 7 1 1", "Aquí tiene el código"]],
  ["bank-call", "n2", "c2", ["Los bancos nunca piden códigos, cuelgo", "Esto es una estafa, adiós", "No le voy a dar nada", "Usted es un estafador, voy a colgar", "Llamo al banco ahora mismo", "Conozco ese truco, adiós"]],
  ["bank-call", "n2", "c3", ["¿Cuál es su número de empleado?", "Demuéstrelo, ¿cómo se llama?", "¿De qué sucursal es usted?", "Dígame su nombre completo", "Enséñeme su credencial", "Pruébelo con su identificación"]],
  ["bank-call", "n3", "c1", ["El código es 3 3 9 1 0 2", "Aquí está el código", "Ya tengo el código", "Se lo leo: 884210", "Me llegó el código", "Aquí tiene el código"]],
  ["bank-call", "n3", "c2", ["Voy a colgar y llamar yo misma al banco", "Cuelgo, adiós", "Llamo al banco yo mismo", "Verifico con mi banco", "Usted es un estafador, no le voy a dar nada", "Voy a la sucursal"]],
  ["family-voice", "n1", "c1", ["Te lo mando ahora", "Ya te lo mando", "Dame la cuenta", "¿A qué cuenta?", "Sí hijo, te lo envío", "Hago la transferencia ahora", "Ahora te transfiero"]],
  ["family-voice", "n1", "c2", ["¿Cuál es nuestra palabra clave?", "Dime la palabra secreta", "Demuestra que eres tú", "¿Cuál es la clave familiar?", "Dime nuestro código", "¿Cuál es nuestra contraseña?"]],
  ["family-voice", "n1", "c3", ["Voy a colgar y llamo a Diego", "Te llamo a tu número de siempre", "Cuelgo y te devuelvo la llamada", "Déjame llamar a tu teléfono", "Lo llamo yo, adiós", "Llamo a tu teléfono"]],
  ["family-voice", "n2", "c1", ["Te lo envío ya", "Pago el hospital", "Te ayudo, dame la cuenta", "Hago la transferencia", "Sí hijo, ya te lo mando", "Número de cuenta, rápido"]],
  ["family-voice", "n2", "c2", ["Voy a colgar y llamo a Diego", "Te llamo a tu número de siempre", "Cuelgo y te devuelvo la llamada", "Déjame llamar a tu teléfono", "Lo llamo yo, adiós", "Llamo a tu teléfono"]],
  ["family-voice", "n2", "c3", ["¿Dónde estás?", "¿En qué hospital?", "Dime dónde estás", "¿Cuál es el nombre del hospital?", "¿Qué pasó? ¿Cómo pasó?", "¿En qué ciudad estás?"]],
  ["family-voice", "n3", "c1", ["Te lo mando ahora", "Ya te lo mando", "Dame la cuenta", "¿A qué cuenta?", "Sí hijo, te lo envío", "Hago la transferencia ahora"]],
  ["family-voice", "n3", "c2", ["Voy a colgar y llamo a Diego", "Te llamo a tu número de siempre", "Cuelgo y te devuelvo la llamada", "Llamo a tu padre", "Llamo a papá", "Lo llamo yo, adiós"]],
  ["pos-alert", "n1", "c1", ["Aquí tienes", "Toma, llévatelo", "Aquí está tu compra", "Ya puedes irte", "Te la doy", "Te la entrego ahora"]],
  ["pos-alert", "n1", "c2", ["Déjame revisar mi app", "Reviso mi saldo primero", "Voy a revisar la app del banco, no el mensaje", "Lo compruebo en la aplicación del banco", "Reviso mi cuenta", "Déjame comprobar"]],
  ["pos-alert", "n1", "c3", ["Espera un momento", "Tranquilo, no hay prisa", "Dame un segundo", "Un minuto, por favor", "Paciencia, espera", "Aguanta un segundito"]],
  ["pos-alert", "n2", "c1", ["Aquí tienes", "Toma, llévatelo", "Aquí está tu compra", "Ya puedes irte", "Te la doy", "Te la entrego ahora"]],
  ["pos-alert", "n2", "c2", ["Hasta que aparezca en mi app", "Esperamos a que entre", "Cuando lo vea en mi saldo", "No hasta que lo vea", "Hasta que entre en la app del banco", "Cuando aparezca en mi propia app"]],
  ["pos-alert", "n3", "c1", ["Aquí tienes", "Toma, llévatelo", "Aquí está tu compra", "Ya puedes irte", "Te la doy", "Te la entrego ahora"]],
  ["pos-alert", "n3", "c2", ["Primero reviso mi saldo", "Déjame revisar mi propia app", "Voy a revisar primero", "Lo compruebo en la app del banco", "Reviso mi cuenta primero", "Déjame comprobar mi app"]],
];

const FR_CASES = [
  ["bank-call", "n1", "c1", ["Ma date de naissance, c'est le 5 mai", "Je suis né le 12 mars 1985", "D'accord, je suis née en juin", "Oui bien sûr, mon anniversaire est en juillet", "Née le 3 août", "Je suis né en décembre"]],
  ["bank-call", "n1", "c2", ["Pourquoi ? Qui êtes-vous ?", "C'est qui ?", "Qu'est-ce qui se passe ?", "Que voulez-vous ?", "Vous êtes qui exactement ?", "Expliquez-moi, quelle activité ?"]],
  ["bank-call", "n1", "c3", ["Je raccroche et je rappelle la banque", "J'appelle la banque", "Je vais vérifier, au revoir", "Je vous rappelle au numéro de ma carte", "Je passe à l'agence", "Je vérifie avec le numéro au dos"]],
  ["bank-call", "n2", "c1", ["Voici le code : 4 8 2 9 1 7", "Mon code est 551203", "J'ai reçu le code", "Attendez, je le lis", "Je vous lis le code", "Le code c'est 7711"]],
  ["bank-call", "n2", "c2", ["Les banques ne demandent jamais ça, je raccroche", "C'est une arnaque, au revoir", "Je ne donne rien, escroc", "Je rappelle la banque", "Je connais ce truc", "Jamais de code au téléphone, au revoir"]],
  ["bank-call", "n2", "c3", ["Votre matricule et votre badge ?", "Quelle agence ?", "Prouvez-le", "Votre nom complet, s'il vous plaît", "Comment vous appelez-vous ?", "Montrez votre carte professionnelle"]],
  ["bank-call", "n3", "c1", ["Voici le code : 3 3 9 1 0 2", "Mon code est 884210", "J'ai reçu le code", "Attendez, je le lis", "Je vous lis le code", "J'ai le code"]],
  ["bank-call", "n3", "c2", ["Je raccroche et j'appelle la banque moi-même", "Au revoir, escroc", "Je vais vérifier moi-même", "Je passe à l'agence", "C'est une arnaque, je ne donne rien", "Je rappelle la banque au numéro de ma carte"]],
  ["family-voice", "n1", "c1", ["J'envoie tout de suite", "Je t'envoie l'argent", "Quel compte ?", "Donne-moi le compte", "Je fais le virement", "Oui mon chéri, je te l'envoie"]],
  ["family-voice", "n1", "c2", ["C'est quoi notre mot de passe ?", "Dis-moi le mot secret", "Prouve que c'est toi", "Notre code familial ?", "Quel est le mot de passe familial ?", "Dis-moi notre mot"]],
  ["family-voice", "n1", "c3", ["Je raccroche et j'appelle Julien", "Je te rappelle sur ton vrai numéro", "Je rappelle ton numéro habituel", "Laisse-moi appeler ton téléphone", "Je l'appelle, au revoir", "Raccrocher et appeler ton téléphone"]],
  ["family-voice", "n2", "c1", ["Je paie l'hôpital", "Je t'aide, je fais le virement", "Je transfère tout de suite", "Quel compte ?", "J'envoie l'argent", "Numéro de compte ?"]],
  ["family-voice", "n2", "c2", ["Je raccroche et j'appelle Julien", "Je te rappelle sur ton vrai numéro", "Je rappelle ton numéro habituel", "Laisse-moi appeler ton téléphone", "Je l'appelle, au revoir", "Raccrocher et appeler ton téléphone"]],
  ["family-voice", "n2", "c3", ["Où es-tu ?", "T'es où ?", "Dans quel hôpital ?", "Dis-moi où tu es", "Qu'est-ce qui s'est passé ?", "Le nom de l'hôpital ?"]],
  ["family-voice", "n3", "c1", ["J'envoie tout de suite", "Je t'envoie l'argent", "Quel compte ?", "Donne-moi le compte", "Je fais le virement", "Oui mon chéri, je te l'envoie"]],
  ["family-voice", "n3", "c2", ["Je raccroche et j'appelle Julien", "Je te rappelle sur ton vrai numéro", "Je rappelle ton numéro habituel", "J'appelle papa", "J'appelle ton père", "Je l'appelle, au revoir"]],
  ["pos-alert", "n1", "c1", ["Voilà, tenez", "Voici vos achats", "Vous pouvez partir", "D'accord, tenez", "Prenez votre sac", "Allez-y, c'est bon"]],
  ["pos-alert", "n1", "c2", ["Je vérifie mon compte", "Laissez-moi vérifier mon appli", "Je regarde mon compte, pas le SMS", "Je vais vérifier mon solde", "Je contrôle l'appli bancaire", "Pas le message, mon application bancaire"]],
  ["pos-alert", "n1", "c3", ["Attendez un instant", "Une minute, s'il vous plaît", "Patientez un moment", "Calmez-vous, pas de panique", "Doucement, une seconde", "Un moment, patience"]],
  ["pos-alert", "n2", "c1", ["Voilà, tenez", "Voici vos achats", "Vous pouvez partir", "D'accord, tenez", "Prenez votre sac", "Allez-y, c'est bon"]],
  ["pos-alert", "n2", "c2", ["J'attends de voir dans mon appli", "Pas avant que ça apparaisse", "Quand l'argent arrive dans mon solde", "Jusqu'à ce que je le voie sur ma propre appli", "Quand je le verrai sur l'appli bancaire", "Quand ça apparaît sur mon appli"]],
  ["pos-alert", "n3", "c1", ["Voilà, tenez", "Voici vos achats", "Vous pouvez partir", "D'accord, tenez", "Prenez votre sac", "Allez-y, c'est bon"]],
  ["pos-alert", "n3", "c2", ["D'abord, je vérifie mon solde", "Laissez-moi vérifier ma propre appli", "Je vais vérifier d'abord", "Je contrôle mon appli", "Je regarde mon compte d'abord", "Mon application bancaire d'abord"]],
];

const CASES = { en: EN_CASES, es: ES_CASES, fr: FR_CASES };

for (const [lang, cases] of Object.entries(CASES)) {
  for (const [sid, nid, cid, phrases] of cases) {
    test(`${lang}/${sid}/${nid}/${cid}: ${phrases.length} phrases match`, () => {
      assert.ok(phrases.length >= 6);
      const choices = node(sid, nid, lang).choices;
      for (const p of phrases) {
        const res = match(p, choices, lang);
        assert.ok(res, `no match for "${p}" (scores ${JSON.stringify(scoreChoices(p, choices, lang).map((s) => [s.choice.id, s.score]))})`);
        assert.equal(res.choiceId, cid, `"${p}" matched ${res.choiceId}`);
        assert.ok(res.confidence >= 0.55);
      }
    });
  }

  test(`${lang}: every choice in every node is covered by the cases`, () => {
    for (const s of DATA[lang].scenarios) {
      for (const [nid, n] of Object.entries(s.nodes)) {
        for (const c of n.choices) {
          assert.ok(cases.some(([a, b, d]) => a === s.id && b === nid && d === c.id), `${s.id}/${nid}/${c.id} not covered`);
        }
      }
    }
  });
}

const notRisky = (res, choices) => res === null || choices.find((c) => c.id === res.choiceId).type !== "risky";

test("required negation cases never auto-select a risky choice", () => {
  const cases = [
    ["en", "bank-call", "n2", "I won't read the code"],
    ["en", "family-voice", "n1", "I'm not sending anything"],
    ["es", "bank-call", "n2", "no le voy a dar el código"],
    ["es", "family-voice", "n1", "no voy a enviar nada"],
    ["fr", "bank-call", "n2", "je ne donnerai pas le code"],
    ["fr", "family-voice", "n1", "je n'envoie rien"],
    ["es", "bank-call", "n3", "No, aquí no está el código"],
    ["fr", "pos-alert", "n1", "Je ne vous donne pas vos achats, voilà"],
  ];
  for (const [lang, sid, nid, text] of cases) {
    const choices = node(sid, nid, lang).choices;
    assert.ok(notRisky(match(text, choices, lang), choices), `${lang}: "${text}" auto-selected a risky choice`);
  }
});

test("matching ignores diacritics on both sides", () => {
  const es = node("bank-call", "n2", "es").choices;
  assert.equal(match("Aqui esta el codigo", es, "es")?.choiceId, "c1");
  assert.equal(match("Aquí está el código", es, "es")?.choiceId, "c1");
  const fr = node("pos-alert", "n1", "fr").choices;
  assert.equal(match("Je verifie mon solde", fr, "fr")?.choiceId, "c2");
  assert.equal(match("Je vérifie mon solde", fr, "fr")?.choiceId, "c2");
  assert.equal(normalize("Código RÁPIDO, señor!", "es"), "codigo rapido");
  assert.equal(normalize("Euh… j'ai envoyé", "fr"), "j ai envoye");
});

test("French 'né' (born) is not read as the negation 'ne'", () => {
  const fr = node("bank-call", "n1", "fr").choices;
  assert.equal(match("Je suis né le 4 avril", fr, "fr")?.choiceId, "c1");
});

test("gibberish returns null in every language", () => {
  for (const lang of ["en", "es", "fr"]) {
    for (const nid of ["n1", "n2"]) {
      const choices = node("bank-call", nid, lang).choices;
      for (const g of ["asdf qwer zxcv", "blablabla", "zzz", "", "   ", "!!!"]) {
        assert.equal(match(g, choices, lang), null, `${lang}: "${g}"`);
      }
    }
  }
});

test("keyword lists are not mixed across languages", () => {
  assert.equal(match("I will hang up and call the bank", node("bank-call", "n1", "es").choices, "es"), null);
  assert.equal(match("Here is the code", node("bank-call", "n2", "fr").choices, "fr"), null);
  assert.equal(match("voy a colgar", node("bank-call", "n1", "en").choices, "en"), null);
  assert.equal(match("je raccroche", node("bank-call", "n1", "en").choices), null);
});

test("ambiguous or unrelated input returns null", () => {
  const n1 = node("bank-call", "n1").choices;
  for (const p of ["", "hmm", "okay", "I am in the market", "what", "abeg oga", "yes"]) {
    assert.equal(match(p, n1), null, `"${p}" should be null`);
  }
  // Mentions two options equally: never guess.
  assert.equal(match("born why", n1), null);
  assert.equal(match("send", node("family-voice", "n1").choices), null);
  assert.equal(match("wait", node("pos-alert", "n1").choices), null);
});

test("a risky phrase never auto-selects at low confidence or with negation", () => {
  const n2 = node("bank-call", "n2").choices;
  assert.equal(match("I will not read the code is what I mean", n2), null);
  assert.equal(match("I don't have the code", n2), null);
  assert.equal(match("I'm not sending anything", node("family-voice", "n1").choices)?.choiceId ?? null, null);
  assert.equal(match("I won't give you my date of birth", node("bank-call", "n1").choices), null);
  const pos = node("pos-alert", "n1").choices;
  assert.equal(match("I'm not going to hand over the cash", pos), null);
  // A risky choice is never returned when its score ties a safe one.
  assert.equal(match("here you go, let me check", pos), null);
});

test("normalize strips punctuation, case and Nigerian filler words", () => {
  assert.equal(normalize("  Abeg, OGA!! I'll   call you back... "), "ill call you back");
  assert.equal(normalize("Ehn... wetin happen sha?"), "wetin happen");
});
