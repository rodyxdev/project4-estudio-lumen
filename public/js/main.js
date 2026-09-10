/* =========================================================
   Estudio Lumen — JS del frontend (fase 3)
   Vanilla, sin dependencias. Los tres formularios envían por fetch()
   a la API de /api/*; la validación nativa del navegador actúa como
   primera capa y el servidor revalida todo por su cuenta.

   Los formularios incluyen un campo señuelo (company_website) oculto por CSS:
   se reenvía tal cual al backend, que descarta el envío si llega con algo.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. Año dinámico en el footer ---------- */
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  /* ---------- 2. Sombra del header al hacer scroll ---------- */
  const header = document.getElementById('site-header');
  if (header) {
    const updateHeader = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
  }

  /* ---------- 3. Navegación móvil ---------- */
  const navToggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');
  const backdrop = document.getElementById('nav-backdrop');

  function setNav(open) {
    if (!navToggle || !nav) return;
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute(
      'aria-label',
      open ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'
    );
    document.body.classList.toggle('nav-open', open);
    if (backdrop) backdrop.hidden = !open;
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      setNav(navToggle.getAttribute('aria-expanded') !== 'true');
    });

    // Cerrar al elegir un ancla — si no, el panel tapa la sección de destino.
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a[href^="#"]')) setNav(false);
    });

    if (backdrop) backdrop.addEventListener('click', () => setNav(false));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setNav(false);
    });

    // Al pasar a layout de escritorio el panel deja de existir: limpiamos estado.
    const desktop = window.matchMedia('(min-width: 900px)');
    const onBreakpoint = (event) => {
      if (event.matches) setNav(false);
    };
    if (typeof desktop.addEventListener === 'function') {
      desktop.addEventListener('change', onBreakpoint);
    }
  }

  /* ---------- 4. Enlace activo según la sección visible ---------- */
  const navLinks = Array.from(document.querySelectorAll('.nav__link'));
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if (sections.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = '#' + entry.target.id;
          navLinks.forEach((link) => {
            link.classList.toggle('is-active', link.getAttribute('href') === id);
          });
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    sections.forEach((section) => observer.observe(section));
  }

  /* ---------- 5. Formularios → API ---------- */

  const NOTE_TIMEOUT_MS = 4000;

  // Cada formulario declara su endpoint y cómo se traduce al contrato de la API.
  const FORMS = [
    {
      id: 'form-cotizacion',
      url: '/api/cotizacion',
      label: 'Cotización',
      payload: (data) => ({
        name: data.nombre,
        email: data.email,
        phone: data.telefono,
        project_type: data.tipo_proyecto,
        budget_range: data.presupuesto,
        message: data.mensaje,
        company_website: data.company_website,
      }),
    },
    {
      id: 'form-newsletter',
      url: '/api/newsletter',
      label: 'Newsletter',
      payload: (data) => ({ email: data.email, company_website: data.company_website }),
    },
    {
      id: 'form-contacto',
      url: '/api/contacto',
      label: 'Contacto',
      payload: (data) => ({
        name: data.nombre,
        email: data.email,
        message: data.mensaje,
        company_website: data.company_website,
      }),
    },
  ];

  const ERROR_RED = 'No pudimos enviar tu mensaje. Revisa tu conexión e inténtalo de nuevo.';
  const ERROR_GENERICO = 'No pudimos procesar tu solicitud. Inténtalo de nuevo en unos minutos.';

  /** Primer mensaje de error de campo que devuelva el servidor, si lo hay. */
  function primerErrorDeCampo(body) {
    if (!body || typeof body.fields !== 'object' || body.fields === null) return '';
    const valores = Object.values(body.fields);
    return valores.length ? String(valores[0]) : '';
  }

  FORMS.forEach(({ id, url, label, payload }) => {
    const form = document.getElementById(id);
    if (!form) return;

    const note = form.querySelector('[data-form-status]');
    const defaultNote = note ? note.textContent.trim() : '';
    const button = form.querySelector('button[type="submit"]');
    const buttonLabel = button ? button.textContent : '';

    /** Pinta el aviso bajo el formulario y programa su limpieza. */
    function showNote(texto, tipo) {
      if (!note) return;
      note.textContent = texto;
      note.classList.remove('is-info', 'is-error');
      note.classList.add(tipo === 'error' ? 'is-error' : 'is-info');

      window.clearTimeout(Number(note.dataset.timerId));
      note.dataset.timerId = String(
        window.setTimeout(() => {
          note.textContent = defaultNote;
          note.classList.remove('is-info', 'is-error');
        }, NOTE_TIMEOUT_MS)
      );
    }

    function setLoading(loading) {
      if (!button) return;
      button.disabled = loading;
      button.textContent = loading ? 'Enviando…' : buttonLabel;
      form.setAttribute('aria-busy', String(loading));
    }

    form.addEventListener('submit', async (event) => {
      // La validación nativa ya ha corrido (los <form> no llevan novalidate):
      // si llegamos aquí, el navegador dio los campos por buenos.
      event.preventDefault();
      if (button && button.disabled) return; // evita doble envío

      const data = Object.fromEntries(new FormData(form).entries());
      setLoading(true);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload(data)),
        });

        // Un 500 puede llegar sin JSON; no queremos que eso rompa el handler.
        let body = null;
        try {
          body = await response.json();
        } catch (_) {
          body = null;
        }

        if (response.ok) {
          showNote((body && body.message) || 'Enviado correctamente.', 'info');
          form.reset();
        } else {
          const detalle = primerErrorDeCampo(body) || (body && body.message) || ERROR_GENERICO;
          console.error(`[${label}] respuesta ${response.status}`, body);
          showNote(detalle, 'error');
        }
      } catch (err) {
        console.error(`[${label}] fallo de red`, err);
        showNote(ERROR_RED, 'error');
      } finally {
        setLoading(false);
      }
    });
  });
})();
