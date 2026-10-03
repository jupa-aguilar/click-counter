# 🧠 Explícamelo

Una app para **aprender a estudiar**. En vez de releer y memorizar, te hace sacar la información de tu cabeza, que es lo que realmente la fija.

## Cómo funciona una sesión

1. **Ideas clave en tus palabras.** Creas un tema y escribes sus ideas principales, una por línea.
2. **Objetivo y foco (Pomodoro).** Defines qué quieres lograr y estudias 15, 25 o 45 minutos con tu material.
3. **Recuerdo activo.** Sin mirar, escribes todo lo que recuerdas.
4. **Comparar.** Marcas qué ideas clave aparecieron. Las que no, son tus lagunas.
5. **Técnica Feynman.** Lo explicas como a un niño de 10 años y anotas dónde te trabaste.
6. **Tarjetas.** Tus lagunas se convierten en tarjetas de pregunta y respuesta.

## Repetición espaciada

En **Repasar**, intentas responder cada tarjeta antes de ver la respuesta y calificas cómo te fue:

| Calificación | Próximo repaso |
|---|---|
| 😣 Difícil | mañana (y otra vez en el mismo repaso) |
| 🙂 Bien | sube un nivel: 1 → 3 → 7 → 15 → 30 → 60 días |
| 😎 Fácil | sube dos niveles |

Una tarjeta se considera **dominada** cuando llega al nivel de 15 días.

En **Progreso** ves tu racha de días, los minutos de foco, las tarjetas dominadas y los temas en riesgo de olvido.

## Tus datos

Todo se guarda en tu navegador (`localStorage`); no hay servidor ni cuenta. Desde **Progreso → Copia de seguridad** puedes exportar un archivo JSON para respaldarlos o pasarlos a otro dispositivo.

## Desarrollo

```bash
npm install
npm run dev     # servidor de desarrollo
npm test        # pruebas de la lógica de repetición espaciada
npm run build   # versión para publicar, en dist/
```

Código en `src/`:

- `main.js`: interfaz y flujo de la sesión, el repaso y el progreso
- `srs.js`: repetición espaciada (sistema Leitner) y fechas
- `store.js`: guardado e importación de datos
- `style.css`: estilos, con modo claro y oscuro
