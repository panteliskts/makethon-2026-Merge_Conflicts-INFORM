export type Locale = "en" | "el";

export const translations = {
  en: {
    nav: {
      signin: "Sign in",
      signout: "Sign out",
      tagline: "Invoice Intelligence",
    },
    landing: {
      badge: "Powered by Gemini 2.0 Flash",
      headline: ["Invoice", "Intelligence,", "Done Right."],
      sub: "Ask questions about your invoices in plain language. Get precise, grounded answers with the exact source region highlighted on the document.",
      cta: "Get Started",
      ctaGhost: "Explore Features",
      socialProof: "Makethon 2026 · Merge Conflicts",
      featuresLabel: "Capabilities",
      featuresTitle: "Everything the brief asked for.",
      processLabel: "How it works",
      processTitle: "Three steps, zero friction.",
      ctaTitle: "Ready to see it work?",
      ctaSub: "Sign in with Google or email — no setup, no configuration.",
      footer: "Makethon 2026 · Merge Conflicts",
      steps: [
        {
          title: "Upload your invoice",
          body: "Drop any PDF. INFORM parses it into semantic chunks — header, line items, totals, payment terms — and indexes each section with its exact page coordinates.",
        },
        {
          title: "Ask in plain language",
          body: "Type any question. The retrieval engine surfaces the most relevant chunks and Gemini 2.0 Flash answers using only what is present in the document.",
        },
        {
          title: "See the source",
          body: "Every answer links to the exact region on the PDF. Click a source chip and that bounding box illuminates on the page — no ambiguity about where the data came from.",
        },
      ],
      features: [
        {
          label: "Retrieval-Augmented Q&A",
          body: "Ask anything about your invoices in plain language. Answers are grounded in the document — not generated from thin air.",
        },
        {
          label: "Visual Source Highlighting",
          body: "Every answer maps to the exact bounding box on the PDF. Click a source chip and the region illuminates.",
        },
        {
          label: "Bank Reconciliation",
          body: "Match invoices against your bank CSV. PAID / UNPAID / PARTIAL in one click.",
        },
        {
          label: "Zero Hallucinations",
          body: "A two-pass self-check grounds every response. Out-of-scope questions get a clean refusal.",
        },
        {
          label: "Live Metrics Dashboard",
          body: "Track accuracy, latency, and grounded-vs-refused counts across every session.",
        },
      ],
    },
    login: {
      title: "Welcome to INFORM",
      sub: "Sign in to start analysing your invoices",
      google: "Continue with Google",
      email: "Sign in with email",
      emailLabel: "Email",
      passwordLabel: "Password",
      emailPlaceholder: "demo@inform.app",
      passwordPlaceholder: "••••••••",
      submit: "Sign in",
      back: "← Back",
      signingIn: "Signing in…",
      errorMsg: "Invalid email or password.",
      demoLabel: "Demo credentials:",
      privacy: "Your invoice data is processed locally and never stored externally.",
      backHome: "← Back to home",
    },
    dashboard: {
      tabs: { chat: "Chat", reconcile: "Reconcile", metrics: "Metrics" },
      tagline: "Invoice workspace",
    },
    chat: {
      upload: "Upload Invoice",
      uploading: "Processing…",
      placeholder: "Ask about this invoice…",
      empty: "Upload an invoice to begin",
      emptySub: "Questions, source chips, and PDF highlights appear here.",
      lowConfidence: "Low confidence",
      sourcesLabel: "Sources",
    },
    pdf: {
      noDoc: "No document loaded",
      noDocSub: "Upload an invoice to render page highlights.",
      prev: "Prev",
      next: "Next",
      loading: "Loading…",
      page: (c: number, t: number) => `Page ${c} of ${t}`,
    },
    reconcile: {
      sectionLabel: "Payment review",
      title: "Bank Reconciliation",
      sub: "Compare an indexed invoice against bank statement rows.",
      refresh: "Refresh invoices",
      bankLabel: "Bank statement CSV",
      bankHint: "Select a CSV export from the bank",
      invoiceLabel: "Indexed invoice source",
      invoiceDefault: "Use all indexed invoices",
      invoiceHint: "Upload invoices in the Chat tab first.",
      run: "Run Reconciliation",
      running: "Reconciling…",
      results: "Results",
      paid: "Paid", partial: "Partial", unpaid: "Unpaid",
      invNum: "Invoice #", invAmt: "Invoice Amount",
      bankAmt: "Bank Amount", status: "Status",
    },
    metrics: {
      title: "Evaluation Metrics",
      sub: "Live pipeline performance — refreshes every 10 s",
      refresh: "Refresh",
      totalQueries: "Total Queries",
      avgLatency: "Avg Latency",
      avgLatencySub: "end-to-end incl. self-check",
      grounded: "Grounded Responses",
      refused: "Refused (Out of Scope)",
      chartTitle: "Grounded vs Refused",
      groundedLabel: "Grounded",
      refusedLabel: "Refused (hallucination prevention)",
      empty: "No queries yet — ask some questions in the Chat tab",
    },
  },

  el: {
    nav: {
      signin: "Σύνδεση",
      signout: "Αποσύνδεση",
      tagline: "Ευφυής Τιμολόγηση",
    },
    landing: {
      badge: "Με τεχνολογία Gemini 2.0 Flash",
      headline: ["Ευφυής", "Ανάλυση", "Τιμολογίων."],
      sub: "Κάντε ερωτήσεις για τα τιμολόγιά σας σε απλή γλώσσα. Λάβετε ακριβείς, τεκμηριωμένες απαντήσεις με επισήμανση της ακριβούς πηγής στο έγγραφο.",
      cta: "Ξεκινήστε",
      ctaGhost: "Εξερευνήστε",
      socialProof: "Makethon 2026 · Merge Conflicts",
      featuresLabel: "Δυνατότητες",
      featuresTitle: "Ό,τι χρειάζεστε, σε ένα εργαλείο.",
      processLabel: "Πώς λειτουργεί",
      processTitle: "Τρία βήματα, μηδέν τριβή.",
      ctaTitle: "Έτοιμοι να το δείτε;",
      ctaSub: "Συνδεθείτε με Google ή email — χωρίς ρύθμιση, χωρίς πολυπλοκότητα.",
      footer: "Makethon 2026 · Merge Conflicts",
      steps: [
        {
          title: "Ανεβάστε το τιμολόγιό σας",
          body: "Σύρετε οποιοδήποτε PDF. Το INFORM το αναλύει σε σημασιολογικά τμήματα — επικεφαλίδα, γραμμές, σύνολα, όροι πληρωμής — και ευρετηριάζει κάθε τμήμα με τις ακριβείς συντεταγμένες του στη σελίδα.",
        },
        {
          title: "Ρωτήστε στην καθημερινή γλώσσα",
          body: "Πληκτρολογήστε οποιαδήποτε ερώτηση. Η μηχανή ανάκτησης εντοπίζει τα πιο σχετικά τμήματα και το Gemini 2.0 Flash απαντά αποκλειστικά με βάση το έγγραφο.",
        },
        {
          title: "Δείτε την πηγή",
          body: "Κάθε απάντηση συνδέεται με την ακριβή περιοχή στο PDF. Κάντε κλικ σε ένα chip πηγής και η αντίστοιχη περιοχή φωτίζεται στη σελίδα.",
        },
      ],
      features: [
        {
          label: "Ανάκτηση & Απάντηση (RAG)",
          body: "Ρωτήστε οτιδήποτε για τα τιμολόγιά σας. Οι απαντήσεις βασίζονται αποκλειστικά στο έγγραφο — χωρίς εικασίες.",
        },
        {
          label: "Οπτική Επισήμανση Πηγής",
          body: "Κάθε απάντηση αντιστοιχεί στην ακριβή θέση στο PDF. Κάντε κλικ και η περιοχή φωτίζεται.",
        },
        {
          label: "Τραπεζική Συμφωνία",
          body: "Αντιστοιχήστε τιμολόγια με το τραπεζικό CSV. ΠΛΗΡΩΘΗΚΕ / ΑΠΛΉΡΩΤΟ / ΜΕΡΙΚΌ με ένα κλικ.",
        },
        {
          label: "Μηδενικές Παραισθήσεις",
          body: "Διπλός έλεγχος τεκμηρίωσης σε κάθε απάντηση. Ερωτήσεις εκτός θέματος λαμβάνουν καθαρή άρνηση.",
        },
        {
          label: "Dashboard Μετρικών",
          body: "Παρακολουθήστε ακρίβεια, καθυστέρηση και ποσοστά τεκμηρίωσης σε κάθε συνεδρία.",
        },
      ],
    },
    login: {
      title: "Καλώς ήρθατε στο INFORM",
      sub: "Συνδεθείτε για να αναλύσετε τα τιμολόγιά σας",
      google: "Συνέχεια με Google",
      email: "Σύνδεση με email",
      emailLabel: "Email",
      passwordLabel: "Κωδικός",
      emailPlaceholder: "demo@inform.app",
      passwordPlaceholder: "••••••••",
      submit: "Σύνδεση",
      back: "← Πίσω",
      signingIn: "Σύνδεση…",
      errorMsg: "Λάθος email ή κωδικός.",
      demoLabel: "Demo στοιχεία:",
      privacy: "Τα δεδομένα σας επεξεργάζονται τοπικά και δεν αποθηκεύονται εξωτερικά.",
      backHome: "← Πίσω στην αρχική",
    },
    dashboard: {
      tabs: { chat: "Συνομιλία", reconcile: "Συμφωνία", metrics: "Μετρικά" },
      tagline: "Χώρος εργασίας τιμολογίων",
    },
    chat: {
      upload: "Ανέβασμα Τιμολογίου",
      uploading: "Επεξεργασία…",
      placeholder: "Ρωτήστε για αυτό το τιμολόγιο…",
      empty: "Ανεβάστε ένα τιμολόγιο για να ξεκινήσετε",
      emptySub: "Ερωτήσεις, chips πηγής και επισημάνσεις PDF εμφανίζονται εδώ.",
      lowConfidence: "Χαμηλή εμπιστοσύνη",
      sourcesLabel: "Πηγές",
    },
    pdf: {
      noDoc: "Δεν φορτώθηκε έγγραφο",
      noDocSub: "Ανεβάστε ένα τιμολόγιο για να δείτε επισημάνσεις.",
      prev: "Προηγ.",
      next: "Επόμ.",
      loading: "Φόρτωση…",
      page: (c: number, t: number) => `Σελίδα ${c} από ${t}`,
    },
    reconcile: {
      sectionLabel: "Έλεγχος πληρωμών",
      title: "Τραπεζική Συμφωνία",
      sub: "Συγκρίνετε ένα ευρετηριασμένο τιμολόγιο με γραμμές τραπεζικού αντιγράφου.",
      refresh: "Ανανέωση τιμολογίων",
      bankLabel: "CSV τραπεζικού αντιγράφου",
      bankHint: "Επιλέξτε αρχείο CSV από την τράπεζα",
      invoiceLabel: "Ευρετηριασμένο τιμολόγιο",
      invoiceDefault: "Χρήση όλων των τιμολογίων",
      invoiceHint: "Ανεβάστε τιμολόγια στην καρτέλα Συνομιλία πρώτα.",
      run: "Εκτέλεση Συμφωνίας",
      running: "Συμφωνία…",
      results: "Αποτελέσματα",
      paid: "Πληρωμένα", partial: "Μερικά", unpaid: "Απλήρωτα",
      invNum: "Αρ. Τιμολογίου", invAmt: "Ποσό Τιμολογίου",
      bankAmt: "Ποσό Τράπεζας", status: "Κατάσταση",
    },
    metrics: {
      title: "Μετρικά Αξιολόγησης",
      sub: "Ζωντανή απόδοση pipeline — ανανεώνεται κάθε 10 δλ",
      refresh: "Ανανέωση",
      totalQueries: "Σύνολο Ερωτήσεων",
      avgLatency: "Μέση Καθυστέρηση",
      avgLatencySub: "end-to-end συμπ. αυτοελέγχου",
      grounded: "Τεκμηριωμένες Απαντήσεις",
      refused: "Αρνήσεις (Εκτός Θέματος)",
      chartTitle: "Τεκμηριωμένες vs Αρνήσεις",
      groundedLabel: "Τεκμηριωμένες",
      refusedLabel: "Αρνήσεις (πρόληψη παραισθήσεων)",
      empty: "Δεν υπάρχουν ερωτήσεις ακόμα — κάντε ερωτήσεις στην καρτέλα Συνομιλία",
    },
  },
} as const;

type Widen<TValue> =
  TValue extends (...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : TValue extends readonly (infer Item)[]
      ? readonly Widen<Item>[]
      : TValue extends string
        ? string
        : TValue extends object
          ? { readonly [Key in keyof TValue]: Widen<TValue[Key]> }
          : TValue;

export type T = Widen<typeof translations.en>;
