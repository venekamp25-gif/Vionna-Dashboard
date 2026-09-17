import { slugName } from "./publishChecks";
// Pool of women's names used for product names.
// Each Shopify product is named after one (must be unique across all
// selected stores' catalogues — see useUsedNames). Curated for an elegant
// fashion-brand vibe: single words, pronounceable in EN/DK/FR, no nicknames.
export const WOMEN_NAMES = [
  // ── Danish / Nordic ──────────────────────────────────────────────
  "Agnete", "Alma", "Alva", "Anneli", "Asta", "Astrid", "Birgitte", "Bodil",
  "Britta", "Cecilie", "Ditte", "Edda", "Elin", "Elsa", "Embla", "Erika",
  "Frida", "Freya", "Greta", "Gro", "Gry", "Hanne", "Hedda", "Helga",
  "Helle", "Henriette", "Hilde", "Ida", "Idun", "Inga", "Ingrid", "Jette",
  "Johanne", "Jorunn", "Karin", "Karoline", "Katrine", "Kira", "Klara",
  "Kristine", "Laila", "Lærke", "Lena", "Linnea", "Liv", "Liva", "Liora",
  "Maja", "Malene", "Maren", "Mathilde", "Mette", "Mille", "Mira", "Nanna",
  "Nora", "Pernille", "Rikke", "Ronja", "Sanna", "Saga", "Selma", "Signe",
  "Sigrid", "Sissel", "Solveig", "Stina", "Susanne", "Thea", "Tilde", "Tova",
  "Trine", "Tuva", "Ulrikke", "Vibeke", "Vilma", "Ylva",

  // ── French ───────────────────────────────────────────────────────
  "Adèle", "Adeline", "Agathe", "Aglaé", "Alice", "Alix", "Aline", "Alizée",
  "Amandine", "Amélie", "Anaïs", "Angèle", "Antoinette", "Apolline", "Aurore",
  "Bérénice", "Blanche", "Brigitte", "Camille", "Capucine", "Cécile", "Céleste",
  "Célestine", "Charlotte", "Chloé", "Clémence", "Clémentine", "Colette",
  "Constance", "Coralie", "Cosette", "Daphné", "Delphine", "Édith", "Eléonore",
  "Élise", "Eulalie", "Fanny", "Florence", "Florine", "Gabrielle", "Gisèle",
  "Héloïse", "Hortense", "Inès", "Isabelle", "Jacqueline", "Jeanne", "Joséphine",
  "Julie", "Juliette", "Justine", "Laurence", "Léa", "Liliane", "Lilou",
  "Louise", "Lucile", "Madeleine", "Maëlle", "Manon", "Margaux", "Margot",
  "Marianne", "Marion", "Maud", "Mélanie", "Mélissa", "Mireille", "Nadine",
  "Noémie", "Océane", "Odette", "Ophélie", "Pauline", "Perrine", "Philippine",
  "Renée", "Romane", "Sabine", "Sandrine", "Salomé", "Séraphine", "Sidonie",
  "Simone", "Solange", "Solène", "Sonia", "Sophie", "Stéphanie", "Sylvie",
  "Thérèse", "Valérie", "Véronique", "Violette", "Virginie", "Yolande",
  "Yvonne", "Zoé",

  // ── English ──────────────────────────────────────────────────────
  "Amelia", "Ariel", "Aurora", "Ava", "Beatrice", "Bella", "Brooke", "Calla",
  // (no "Adele" / "Anais" / "Daphne": Shopify gives them the same handle as the
  //  accented "Adèle" / "Anaïs" / "Daphné" above — one slug, one name.)
  "Catherine", "Celia", "Cleo", "Clover", "Cora", "Daisy",
  "Eleanor", "Eliza", "Ella", "Eloise", "Emily", "Emma", "Esme",
  "Estelle", "Eve", "Evelyn", "Faye", "Fern", "Fiona", "Flora", "Gemma",
  "Grace", "Hannah", "Harriet", "Hazel", "Imogen", "Iris", "Isla", "Ivy",
  "Jasmine", "Jenna", "Josie", "Joy", "Juno", "Kate", "Lara", "Lila",
  "Lily", "Lola", "Lottie", "Lyra", "Mabel", "Maeve", "Martha",
  "Matilda", "Maya", "Mia", "Mila", "Millie", "Nell", "Nina", "Olive",
  "Olivia", "Ophelia", "Pearl", "Penelope", "Phoebe", "Piper", "Poppy",
  "Quinn", "Rosa", "Rose", "Ruby", "Ruth", "Sadie", "Sasha",
  "Sophia", "Stella", "Tess", "Tessa", "Valentina", "Victoria", "Violet",
  "Vivian", "Willow", "Wren",

  // ── Additional (Mediterranean / misc but globally readable) ──────
  "Alessia", "Bianca", "Carla", "Elena", "Gaia", "Indira", "Livia", "Lucia",
  "Luna", "Mariana", "Marina", "Noemi", "Nova", "Paloma", "Romy", "Serena",
  "Sienna", "Yara", "Zara",
  // 2026-08-31: de pool was OP (280 namen, 701 titels in gebruik over de 3
  // winkels). Elke nieuwe listing botste per definitie met een bestaande naam.
  // Zelfde stijl (Scandinavisch/Frans), gefilterd op wat al in gebruik was.
  "Aase",
  "Aïda",
  "Ailsa",
  "Aina",
  "Alette",
  "Alfhild",
  "Andrea",
  "Anouk",
  "Antonie",
  "Ariane",
  "Arielle",
  "Aslaug",
  "Axelle",
  "Bénédicte",
  "Bergljot",
  "Berit",
  "Bettina",
  "Bolette",
  "Borghild",
  "Charline",
  "Christel",
  "Clotilde",
  "Cordelia",
  "Dagmar",
  "Dagny",
  "Dorthe",
  "Dorothée",
  "Ebba",
  "Edel",
  "Eir",
  "Eivor",
  "Eline",
  "Elna",
  "Elodie",
  "Elvira",
  "Emmanuelle",
  "Enya",
  "Eugénie",
  "Filippa",
  "Gerda",
  "Gudrun",
  "Gunhild",
  "Gwenaëlle",
  "Halla",
  "Heidrun",
  "Hjördis",
  "Iselin",
  "Josiane",
  "Karen",
  "Kirsten",
  "Kjersti",
  "Léonie",
  "Ludivine",
  "Magnhild",
  "Marit",
  "Marlène",
  "Marthe",
  "Nathalie",
  "Noor",
  "Oda",
  "Ottilie",
  "Ragna",
  "Ragnhild",
  "Randi",
  "Rosalie",
  "Runa",
  "Sanne",
  "Ségolène",
  "Sigrún",
  "Siri",
  "Sunniva",
  "Svea",
  "Synnøve",
  "Thora",
  "Tone",
  "Tove",
  "Unn",
  "Valentine",
  "Vigdis",
  "Viviane",
  "Ylvi",
  "Yrsa",
  "Ysolde",
  // ── 2026-09-17: de poel was OPNIEUW op (365 namen, 772 in gebruik) en de
  // terugval deelde "Berit 2", "Ylva 2"… uit: 9 kledingstukken, 135 producten.
  // ~1.080 namen erbij: Noords, Fins/Baltisch, Frans, Engels/Keltisch, Romaans,
  // Germaans/Slavisch/Grieks. Twee kritische lezers (rare betekenis in
  // DK/FR/FI/EN; merknaam of geen echte voornaam) + handwerk; uniek op
  // Shopify-slug tegen alle live titels en handles; geen bijna-dubbelen.
  // Opraken wordt nu op tijd gemeld: /api/name_pool_status + dagelijkse Slack-ping.
  "Adela", "Adélaïde", "Adélie", "Adelina", "Adina", "Adriana", "Adrienne", "Aëla", "Aélis", "Agda",
  "Agnes", "Agnese", "Agneta", "Agustina", "Aila", "Aili", "Ailis", "Ainara", "Aino", "Airi",
  "Aitana", "Alaïs", "Alannah", "Albane", "Alberte", "Albertina", "Albertine", "Albina", "Albine", "Alexandra",
  "Alexandrine", "Alfrida", "Alicia", "Aliette", "Aliki", "Almudena", "Aloïse", "Althea", "Alvilde", "Alwine",
  "Amaia", "Amalia", "Amalie", "Ambra", "Anaëlle", "Andra", "Andrine", "Aneta", "Angelica", "Angeline",
  "Angélique", "Aniela", "Anita", "Anja", "Anke", "Annabel", "Annabella", "Annalisa", "Annelise", "Annelore",
  "Anthea", "Antia", "Antonella", "Antonia", "Antonine", "Apollonie", "Arabella", "Arabelle", "Araceli", "Aranka",
  "Ariadna", "Ariadne", "Arianna", "Arja", "Arlet", "Arlette", "Armande", "Armelle", "Arna", "Astri",
  "Athénaïs", "Aubane", "Aude", "Aurelia", "Aurelija", "Aveline", "Axelina", "Azélie", "Balbina", "Baptistine",
  "Bastienne", "Bathilde", "Beata", "Beate", "Béatrix", "Beatriz", "Belinda", "Benedetta", "Benedikte", "Benedita",
  "Bérangère", "Bernadette", "Berta", "Bethan", "Birgit", "Birgitta", "Birna", "Birte", "Birthe", "Blandine",
  "Blenda", "Bojana", "Branwen", "Brina", "Bronwen", "Brynja", "Caitlin", "Calina", "Candace", "Carina",
  "Carine", "Carlotta", "Carmela", "Carola", "Carole", "Carys", "Cassandra", "Catarina", "Caterina", "Cathrine",
  "Catrin", "Catriona", "Cecilia", "Cecily", "Celestina", "Céliane", "Célimène", "Césarine", "Charis", "Charlène",
  "Charlotta", "Chiara", "Chimène", "Christabel", "Christelle", "Christiane", "Christine", "Ciara", "Cintia", "Cinzia",
  "Claribel", "Clarice", "Clarinda", "Clarissa", "Clarisse", "Cléa", "Clélia", "Clélie", "Clementina", "Cléophée",
  "Clervie", "Cliona", "Clorinde", "Coline", "Colleen", "Colombe", "Corina", "Corisande", "Cornelia", "Cornélie",
  "Cosmina", "Crina", "Cristiana", "Cristina", "Cynthia", "Cyprienne", "Cyriane", "Cyrielle", "Dahlia", "Daina",
  "Daiva", "Dalia", "Dalma", "Damaris", "Damiana", "Danae", "Danica", "Danielle", "Darina", "Davina",
  "Debora", "Deborah", "Deirdre", "Delfina", "Delia", "Denisa", "Denise", "Despina", "Diletta", "Dimitra",
  "Dina", "Dinah", "Dinora", "Doina", "Dominika", "Domitilla", "Domitille", "Donata", "Donatienne", "Dora",
  "Doriana", "Doriane", "Dorina", "Dorota", "Dorotea", "Dorothea", "Dorthea", "Durita", "Edina", "Edla",
  "Eduarda", "Edwige", "Edwina", "Edyta", "Eevi", "Églantine", "Egle", "Eila", "Eileen", "Eira",
  "Eirin", "Eirini", "Elaia", "Elain", "Élaine", "Eleanora", "Eleni", "Eleonora", "Elettra", "Elfrida",
  "Élia", "Eliana", "Éliane", "Éliette", "Elisa", "Elisabeth", "Elisabetta", "Elke", "Ellen", "Elmire",
  "Éloane", "Élora", "Elowen", "Elsbeth", "Else", "Elske", "Elspeth", "Elva", "Elvina", "Elvire",
  "Elza", "Émeline", "Émérance", "Emese", "Emilie", "Émilienne", "Enora", "Enrica", "Erja", "Erle",
  "Ermeline", "Erminia", "Ernestine", "Ersilia", "Esperanza", "Estefania", "Estela", "Ester", "Esther", "Étiennette",
  "Eugenia", "Eulalia", "Eunice", "Euphémie", "Euphrasie", "Evangelia", "Évangéline", "Evanthia", "Evelina", "Évelyne",
  "Ewelina", "Eydis", "Fabia", "Fabiana", "Fabiola", "Famke", "Fausta", "Federica", "Félicie", "Félicienne",
  "Félicité", "Felicity", "Femke", "Fenella", "Fenja", "Fenne", "Fernanda", "Fiamma", "Fidelia", "Filomena",
  "Fiorella", "Fiorenza", "Flaminia", "Flavie", "Flavienne", "Florbela", "Florentina", "Florentine", "Floriana", "Floriane",
  "Florinda", "Fosca", "Fotini", "Franceline", "Francesca", "Francine", "Francisca", "Françoise", "Franka", "Franziska",
  "Freda", "Frederica", "Frederikke", "Fredrika", "Freydis", "Fride", "Gabija", "Gabriela", "Gaëlle", "Gaëtane",
  "Garance", "Gelsomina", "Genoveva", "Georgette", "Georgiana", "Georgina", "Georgine", "Géraldine", "Gerlinde", "Germaine",
  "Gersende", "Gesine", "Ghislaine", "Giacinta", "Giada", "Gianna", "Gilberte", "Gilda", "Gillian", "Ginevra",
  "Gioia", "Giorgia", "Giovanna", "Gisela", "Giuditta", "Giulia", "Giuliana", "Giulietta", "Glenna", "Glenys",
  "Gloria", "Gordana", "Graciela", "Graziella", "Guillemette", "Gunilla", "Gurli", "Gwenda", "Gwendolen", "Gwendoline",
  "Gwendolyn", "Gwenola", "Gyda", "Halina", "Halldora", "Hannele", "Hannelore", "Harmonie", "Hedvig", "Heida",
  "Helena", "Helene", "Heli", "Hélia", "Helina", "Helma", "Helmi", "Henrietta", "Henrika", "Henrike",
  "Herdis", "Herminie", "Hester", "Hilda", "Hildegard", "Hilja", "Hilla", "Hille", "Hillevi", "Hilma",
  "Honora", "Honorine", "Ianthe", "Iara", "Idalia", "Idalina", "Ieva", "Iina", "Ilaria", "Ileana",
  "Iliana", "Ilinca", "Ilka", "Ilmi", "Ilona", "Ilse", "Imelda", "Imke", "Inese", "Ineta",
  "Ingeborg", "Ingela", "Ingelin", "Ingelise", "Inger", "Ingerid", "Ingri", "Ingrida", "Ingunn", "Ingvild",
  "Inken", "Inta", "Ioana", "Iolanda", "Iolanthe", "Ione", "Irati", "Irena", "Irene", "Iria",
  "Irina", "Irja", "Irmela", "Isabel", "Isadora", "Isaura", "Isaure", "Iseult", "Ishbel", "Isidora",
  "Ismene", "Ismérie", "Isobel", "Isolda", "Iva", "Ivana", "Iveta", "Jaanika", "Jacinta", "Jacinthe",
  "Jacobine", "Jana", "Janaina", "Janeli", "Janina", "Janine", "Jannike", "Jeanette", "Jehanne", "Jelena",
  "Jennifer", "Jessica", "Joana", "Jocelyne", "Joëlle", "Johanna", "Jolana", "Jolanta", "Jolien", "Jolijn",
  "Joline", "Jolita", "Jonna", "Jordina", "Jorid", "Josée", "Josefina", "Josefine", "Josette", "Josipa",
  "Julia", "Juliana", "Juliane", "Julienne", "Julita", "Julitte", "Junia", "Justina", "Kaidi", "Kaili",
  "Kaisa", "Kaisu", "Kalina", "Kamila", "Kamile", "Karianne", "Karina", "Karine", "Karita", "Karolina",
  "Kassandra", "Katarina", "Katell", "Katharina", "Käthe", "Kathleen", "Katia", "Katinka", "Katja", "Katri",
  "Katrien", "Katrin", "Keeva", "Kerensa", "Kersti", "Kerstin", "Kiera", "Kirsi", "Kirsti", "Kirstine",
  "Kristel", "Kristiana", "Kristina", "Kyla", "Laetitia", "Laia", "Laina", "Lalie", "Larissa", "Laure",
  "Laurène", "Laurette", "Lauriane", "Laurinda", "Laurine", "Lavinia", "Léana", "Léandra", "Leida", "Leire",
  "Lélia", "Lenka", "Leocadia", "Leona", "Léone", "Leonor", "Leonora", "Leontina", "Léontine", "Léopoldine",
  "Leticia", "Letizia", "Lia", "Liadan", "Liana", "Lidia", "Liene", "Liesbeth", "Lieselotte", "Lieve",
  "Ligia", "Liisbet", "Liliana", "Lilias", "Lilija", "Lilja", "Lillian", "Lilwenn", "Lisbeth", "Lise",
  "Liselott", "Liselotte", "Lisette", "Lison", "Livija", "Lorea", "Loredana", "Lorena", "Lorenza", "Loreta",
  "Lorette", "Lorna", "Lotta", "Louisette", "Lovisa", "Lowenna", "Lowri", "Lucette", "Luciana", "Lucienne",
  "Lucija", "Lucilla", "Lucinda", "Lucinde", "Lucrèce", "Lucretia", "Ludovica", "Luisa", "Lydia", "Lydie",
  "Lynette", "Lysandra", "Maarika", "Maarja", "Maddalena", "Madelen", "Maëla", "Maëva", "Mafalda", "Magali",
  "Magdalena", "Magnea", "Mahaut", "Maialen", "Maija", "Maiken", "Maila", "Maira", "Maire", "Mairi",
  "Maitena", "Maïwenn", "Majbritt", "Majken", "Majlis", "Malena", "Malin", "Malina", "Malvina", "Manuela",
  "Marcela", "Marcelina", "Marceline", "Marcelle", "Mareike", "Maret", "Margaret", "Margareta", "Margarete", "Margarida",
  "Margarita", "Margherita", "Margit", "Margrete", "Mariann", "Maribel", "Maricel", "Marieke", "Mariela", "Marielle",
  "Marietta", "Mariette", "Marilena", "Marilia", "Marilla", "Marinella", "Mariola", "Mariona", "Marisa", "Marisela",
  "Mariska", "Marisol", "Maristella", "Marita", "Marjatta", "Marjolaine", "Marjorie", "Marketa", "Marlies", "Marlyse",
  "Märta", "Martina", "Martine", "Maryla", "Marylène", "Maryline", "Maryse", "Marzia", "Matea", "Mathea",
  "Matilde", "Maureen", "Meeri", "Meike", "Meja", "Melinda", "Méline", "Mélisande", "Melita", "Meredith",
  "Merete", "Merike", "Merili", "Merja", "Mervi", "Micaela", "Michalina", "Michela", "Michèle", "Micheline",
  "Milada", "Milda", "Milena", "Milja", "Millicent", "Minea", "Minna", "Mirabel", "Mireia", "Mirela",
  "Miriam", "Mirja", "Mirjam", "Mirjana", "Mirka", "Mirta", "Mirte", "Miruna", "Moïra", "Monique",
  "Morna", "Morwenna", "Muriel", "Murielle", "Mylène", "Myriam", "Nadège", "Nahia", "Naiara", "Naïs",
  "Narcisa", "Natacha", "Natalia", "Neea", "Neja", "Nela", "Nele", "Nerea", "Nerina", "Nerissa",
  "Nerys", "Nicole", "Nicoletta", "Nicolette", "Nienke", "Nikolina", "Nikoline", "Noelia", "Noélie", "Noéline",
  "Noëlle", "Nolwenn", "Noomi", "Noreen", "Norine", "Nuria", "Oana", "Octavia", "Octavie", "Odélia",
  "Odeta", "Odile", "Ofelia", "Olalla", "Olaya", "Olga", "Olimpia", "Olinda", "Oline", "Olita",
  "Ombeline", "Ona", "Orane", "Oriane", "Oriella", "Orinta", "Orlane", "Orna", "Orsola", "Ortensia",
  "Ottavia", "Palmira", "Palmyre", "Pascaline", "Patricia", "Patrizia", "Paula", "Paulina", "Pavla", "Pélagie",
  "Pernelle", "Petra", "Petronella", "Pétronille", "Phaedra", "Philippa", "Phyllida", "Phyllis", "Piera", "Pierrette",
  "Pihla", "Piia", "Pilar", "Pinja", "Polona", "Prisca", "Priscilla", "Priscille", "Priska", "Quitterie",
  "Rachel", "Rachele", "Rafaela", "Ragne", "Ragni", "Raili", "Raisa", "Rakel", "Raluca", "Raminta",
  "Raphaëlle", "Raquel", "Rasa", "Rébecca", "Reetta", "Regina", "Regitze", "Reidun", "Réjane", "Renata",
  "Renate", "Renske", "Rhiannon", "Rhoda", "Rhona", "Rianne", "Ricarda", "Riikka", "Riina", "Riona",
  "Roberta", "Romana", "Romilda", "Rosalba", "Rosaleen", "Rosalia", "Rosalind", "Rosalinda", "Rosaline", "Rosamund",
  "Rosanna", "Rosanne", "Rosaria", "Rosaura", "Roseanne", "Roseline", "Rosemarie", "Rosemonde", "Rosina", "Rosine",
  "Roslyn", "Rossella", "Roxana", "Roxanne", "Rozenn", "Ruta", "Sabela", "Sabina", "Saija", "Saila",
  "Saima", "Salka", "Salla", "Samantha", "Sandra", "Sanja", "Santina", "Sarolta", "Saskia", "Satu",
  "Saveria", "Savine", "Seija", "Sélène", "Senta", "Serafina", "Servane", "Severina", "Séverine", "Shauna",
  "Sheena", "Shona", "Sibilla", "Sibylle", "Sidonia", "Sidse", "Sidsel", "Sigita", "Signy", "Silja",
  "Silje", "Silke", "Silvana", "Silvia", "Silvina", "Simona", "Siv", "Sixtine", "Soile", "Soledad",
  "Solfrid", "Soline", "Solrun", "Sølvi", "Solvor", "Sorina", "Stefania", "Sterenn", "Stine", "Sunna",
  "Sunneva", "Susanna", "Suvi", "Suzel", "Svala", "Svandis", "Svava", "Sybil", "Sylvaine", "Sylvette",
  "Sylviane", "Synne", "Tabea", "Tabitha", "Taimi", "Taina", "Tamara", "Tamsin", "Tania", "Tanja",
  "Tanwen", "Tarja", "Taru", "Tatiana", "Tecla", "Teija", "Telma", "Teona", "Teresa", "Tereza",
  "Terhi", "Thalia", "Thalie", "Thekla", "Thelma", "Theodosia", "Thyra", "Tiina", "Tilda", "Timea",
  "Tindra", "Tineke", "Tiphaine", "Tiril", "Tirza", "Tiziana", "Tonje", "Tora", "Tordis", "Toril",
  "Tressa", "Tullia", "Turid", "Tuula", "Tuuli", "Ula", "Ulrika", "Umbelina", "Una", "Vaida",
  "Vaila", "Vaiva", "Vala", "Valborg", "Valeria", "Valériane", "Valeska", "Vedis", "Velia", "Velta",
  "Vendela", "Vendula", "Venla", "Verena", "Veronica", "Victoire", "Victorine", "Vida", "Vilde", "Vilhelmina",
  "Vilja", "Vincenza", "Vinciane", "Vineta", "Violaine", "Violante", "Violetta", "Virva", "Virve", "Vitaline",
  "Vittoria", "Viveka", "Vivette", "Viviana", "Wenna", "Wilhelmina", "Wilma", "Winifred", "Wivine", "Xanthe",
  "Ximena", "Yaëlle", "Yasmine", "Ylfa", "Yolaine", "Yseult", "Yuna", "Yveline", "Yvette", "Zaira",
  "Zanda", "Zélia", "Zelinda", "Zéline", "Zénaïde", "Zenobia", "Zenta", "Zéphyrine", "Zilda", "Zillah",
  "Zinta", "Zita", "Zlata",
];

/** How much of the pool is still free, given the names already in use. */
export function poolStatus(exclude: string[] = []): { total: number; free: number } {
  const taken = new Set(exclude.map((n) => slugName(n)));
  const slugs = new Set(WOMEN_NAMES.map((n) => slugName(n)));
  let free = 0;
  slugs.forEach((s) => {
    if (!taken.has(s)) free++;
  });
  return { total: slugs.size, free };
}

// Last resort when every pool name is taken: compose a name-shaped word from
// real-name morphology ("Cor" + "ine", "Val" + "ette"). NEVER a number: the old
// fallback handed out "Berit 2", "Ylva 2" — 135 products got one in Sept 2026
// the moment the pool ran dry, with "berit-2-siblings" collections and
// "VIONNA-Berit 2-…" SKUs to match.
// Stems/endings picked so no combination is a common noun in FR/DK/FI/EN
// (no "-ette": galette, belette, lavette; no "Sal-", "Or-", "Gal-").
const INVENT_STEMS = [
  "Al", "Am", "An", "Ar", "Av", "Bel", "Cal", "Cor", "Dal", "El", "Em", "Ev", "Fel", "Hel", "Il",
  "Is", "Jul", "Kal", "Lav", "Lil", "Liv", "Lor", "Luc", "Mar", "Mel", "Mir", "Nel", "Nor", "Ol",
  "Ros", "Sel", "Sil", "Sol", "Tal", "Val", "Vel", "Vil", "Yl", "Zel",
];
const INVENT_ENDINGS = ["ia", "ina", "ine", "elle", "ara", "ella", "isa", "ita", "ene", "iane", "ora"];

function inventName(taken: Set<string>): string {
  const total = INVENT_STEMS.length * INVENT_ENDINGS.length;
  const start = Math.floor(Math.random() * total);
  for (let i = 0; i < total; i++) {
    const k = (start + i) % total;
    const candidate = INVENT_STEMS[Math.floor(k / INVENT_ENDINGS.length)] + INVENT_ENDINGS[k % INVENT_ENDINGS.length];
    if (!taken.has(slugName(candidate))) return candidate;
  }
  return ""; // pool AND every composed name taken: let the operator type one
}

/**
 * Pick a name that isn't in `exclude`.
 *
 * Tier 1: uniformly at random from the unused WOMEN_NAMES entries.
 * Tier 2 (pool exhausted): a composed, name-shaped single word (see
 *         inventName). Never "name 2": a numbered name leaks into the handle,
 *         the SKU, the SEO title and the siblings collection.
 * "" only when even that is exhausted — callers must then ask for a typed name.
 */
export function randomName(exclude: string[] = []): string {
  // Op SLUG, niet op kleine letters: 'Adele' en 'Adèle' zijn voor Shopify
  // dezelfde handle en botsen dus ook in de siblings-collecties.
  const taken = new Set(exclude.map((n) => slugName(n)));
  const pool = WOMEN_NAMES.filter((n) => !taken.has(slugName(n)));
  if (pool.length > 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return inventName(taken);
}
