/**
 * Banco reducido de versículos Reina-Valera 1960 usados por el modo LOCAL
 * (sin inteligencia artificial). Texto citado de forma breve con fines de
 * estudio y predicación. Revise siempre las citas antes de publicar.
 */
export type Verse = { ref: string; text: string; topics: string[] };

export const VERSES: Verse[] = [
  { ref: "Mateo 24:6", text: "Y oiréis de guerras y rumores de guerras; mirad que no os turbéis, porque es necesario que todo esto acontezca; pero aún no es el fin.", topics: ["guerra", "conflicto", "ataque", "misil", "ejército", "militar", "irán", "rusia", "ucrania", "otan", "nuclear"] },
  { ref: "Mateo 24:7", text: "Porque se levantará nación contra nación, y reino contra reino; y habrá pestes, y hambres, y terremotos en diferentes lugares.", topics: ["terremoto", "hambre", "peste", "pandemia", "nación", "sismo", "virus"] },
  { ref: "1 Tesalonicenses 4:16-17", text: "Porque el Señor mismo con voz de mando, con voz de arcángel, y con trompeta de Dios, descenderá del cielo; y los muertos en Cristo resucitarán primero. Luego nosotros los que vivimos, los que hayamos quedado, seremos arrebatados juntamente con ellos en las nubes para recibir al Señor en el aire, y así estaremos siempre con el Señor.", topics: ["arrebatamiento", "rapto", "trompeta", "iglesia"] },
  { ref: "Apocalipsis 13:16-17", text: "Y hacía que a todos, pequeños y grandes, ricos y pobres, libres y esclavos, se les pusiese una marca en la mano derecha, o en la frente; y que ninguno pudiese comprar ni vender, sino el que tuviese la marca o el nombre de la bestia, o el número de su nombre.", topics: ["marca", "bestia", "dinero digital", "moneda digital", "cbdc", "chip", "pago", "biométric", "identidad digital", "efectivo", "control"] },
  { ref: "Daniel 12:4", text: "Pero tú, Daniel, cierra las palabras y sella el libro hasta el tiempo del fin. Muchos correrán de aquí para allá, y la ciencia se aumentará.", topics: ["inteligencia artificial", "tecnología", "ciencia", "robot", "ia ", "algoritmo", "conocimiento"] },
  { ref: "Lucas 21:28", text: "Cuando estas cosas comiencen a suceder, erguíos y levantad vuestra cabeza, porque vuestra redención está cerca.", topics: ["señal", "señales", "últimos tiempos", "fin"] },
  { ref: "Romanos 10:9", text: "que si confesares con tu boca que Jesús es el Señor, y creyeres en tu corazón que Dios le levantó de los muertos, serás salvo.", topics: ["salvación", "salvo", "evangelio"] },
  { ref: "Hechos 4:12", text: "Y en ningún otro hay salvación; porque no hay otro nombre bajo el cielo, dado a los hombres, en que podamos ser salvos.", topics: ["salvación", "religión", "unidad religiosa"] },
  { ref: "Mateo 24:36", text: "Pero del día y la hora nadie sabe, ni aun los ángeles de los cielos, sino sólo mi Padre.", topics: ["fecha", "día", "hora", "predicción"] },
  { ref: "2 Timoteo 3:1", text: "También debes saber esto: que en los postreros días vendrán tiempos peligrosos.", topics: ["postreros", "últimos días", "sociedad", "moral", "crisis"] },
  { ref: "Juan 14:3", text: "Y si me fuere y os preparare lugar, vendré otra vez, y os tomaré a mí mismo, para que donde yo estoy, vosotros también estéis.", topics: ["venida", "regreso", "esperanza"] },
  { ref: "Apocalipsis 22:20", text: "El que da testimonio de estas cosas dice: Ciertamente vengo en breve. Amén; sí, ven, Señor Jesús.", topics: ["venida", "apocalipsis"] },
  { ref: "Mateo 24:14", text: "Y será predicado este evangelio del reino en todo el mundo, para testimonio a todas las naciones; y entonces vendrá el fin.", topics: ["evangelio", "misión", "predicación", "naciones"] },
  { ref: "Zacarías 12:3", text: "Y en aquel día yo pondré a Jerusalén por piedra pesada a todos los pueblos; todos los que se la cargaren serán despedazados, bien que todas las naciones de la tierra se juntarán contra ella.", topics: ["jerusalén", "israel", "naciones", "onu", "gaza"] },
  { ref: "2 Tesalonicenses 2:3-4", text: "Nadie os engañe en ninguna manera; porque no vendrá sin que antes venga la apostasía, y se manifieste el hombre de pecado, el hijo de perdición, el cual se opone y se levanta contra todo lo que se llama Dios o es objeto de culto; tanto que se sienta en el templo de Dios como Dios, haciéndose pasar por Dios.", topics: ["anticristo", "templo", "tercer templo", "apostasía", "hombre de pecado"] },
  { ref: "Mateo 24:9", text: "Entonces os entregarán a tribulación, y os matarán, y seréis aborrecidos de todas las gentes por causa de mi nombre.", topics: ["persecución", "cristianos", "mártir", "iglesia quemada", "perseguidos"] },
  { ref: "Mateo 24:21", text: "porque habrá entonces gran tribulación, cual no la ha habido desde el principio del mundo hasta ahora, ni la habrá.", topics: ["tribulación", "gran tribulación"] },
  { ref: "Apocalipsis 1:7", text: "He aquí que viene con las nubes, y todo ojo le verá, y los que le traspasaron; y todos los linajes de la tierra harán lamentación por él. Sí, amén.", topics: ["segunda venida", "venida", "nubes"] },
  { ref: "Mateo 24:24", text: "Porque se levantarán falsos Cristos, y falsos profetas, y harán grandes señales y prodigios, de tal manera que engañarán, si fuere posible, aun a los escogidos.", topics: ["falso profeta", "engaño", "falsos", "prodigios", "milagro"] },
  { ref: "Apocalipsis 13:11", text: "Después vi otra bestia que subía de la tierra; y tenía dos cuernos semejantes a los de un cordero, pero hablaba como dragón.", topics: ["falso profeta", "segunda bestia"] },
  { ref: "1 Juan 2:18", text: "Hijitos, ya es el último tiempo; y según vosotros oísteis que el anticristo viene, así ahora han surgido muchos anticristos; por esto conocemos que es el último tiempo.", topics: ["anticristo", "último tiempo"] },
  { ref: "Juan 3:16", text: "Porque de tal manera amó Dios al mundo, que ha dado a su Hijo unigénito, para que todo aquel que en él cree, no se pierda, mas tenga vida eterna.", topics: ["amor", "salvación"] },
];

/** Detecta referencias bíblicas escritas en un texto (ej. "Apocalipsis 13:16-17"). */
const BOOKS = [
  "Génesis", "Éxodo", "Levítico", "Números", "Deuteronomio", "Josué", "Jueces", "Rut", "1 Samuel", "2 Samuel", "1 Reyes", "2 Reyes",
  "1 Crónicas", "2 Crónicas", "Esdras", "Nehemías", "Ester", "Job", "Salmos?", "Proverbios", "Eclesiastés", "Cantares", "Isaías",
  "Jeremías", "Lamentaciones", "Ezequiel", "Daniel", "Oseas", "Joel", "Amós", "Abdías", "Jonás", "Miqueas", "Nahúm", "Habacuc",
  "Sofonías", "Hageo", "Zacarías", "Malaquías", "Mateo", "Marcos", "Lucas", "Juan", "Hechos", "Romanos", "1 Corintios", "2 Corintios",
  "Gálatas", "Efesios", "Filipenses", "Colosenses", "1 Tesalonicenses", "2 Tesalonicenses", "1 Timoteo", "2 Timoteo", "Tito", "Filemón",
  "Hebreos", "Santiago", "1 Pedro", "2 Pedro", "1 Juan", "2 Juan", "3 Juan", "Judas", "Apocalipsis",
];
export const REF_RE = new RegExp(`\\b(${BOOKS.join("|")})\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?`, "g");

export function findRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REF_RE)) out.add(m[0].replace(/\s+/g, " "));
  return [...out];
}

export function versesForText(text: string, max = 3): Verse[] {
  const t = text.toLowerCase();
  const scored = VERSES.map((v) => ({ v, s: v.topics.reduce((a, k) => a + (t.includes(k) ? 1 : 0), 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, max).map((x) => x.v);
}
