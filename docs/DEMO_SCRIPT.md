# Simulation personalisation demonstration

This page shows how an initial glucose-response assumption can gradually adapt
when completed observations differ from it. It runs without trained models,
patient records, credentials or paid APIs. Numerical responses are invented
examples, informed only qualitatively by the sources in `OPENHUMANS_TOOLS.md`.

## Start and open

The demonstrator will use a Mac. Install Git and Node 22, including npm. Open
Terminal using Spotlight (Command-Space, type Terminal, then Return). In the
folder where they keep projects, obtain this PR branch:

```bash
git clone --branch feat/parallel-fast-training https://github.com/b2077/glucoloop.git
cd glucoloop
node --version
npm --version
```

GitHub access is required if the repository is private. If they already have a
checkout, save any local changes first, then fetch and switch to this branch.
There is no need to download patient data, copy model files or share secrets.
From the repository root, run the same command on Windows, macOS or Linux:

```bash
npm run demo --prefix services/backend
```

Open `http://localhost:18130/demo`, or select the demonstration link on
`http://localhost:18130/dashboard`. The portable launcher skips environment-file loading and background alert
timers, keeping this presentation independent of ML and chat services. The page works on desktop and mobile browsers; small screens
can scroll the chart horizontally. Stop the foreground server with Ctrl+C.
No `npm install` is needed: the backend uses Node's built-in libraries. Keep
the terminal open. If the port is occupied, edit `port` in
`services/backend/src/demo-config.json` and use the printed address.
This local address belongs to their own computer, not the author's machine.
It does not publish the application to the internet.

To check the code on their machine, run:

```bash
npm test --prefix services/backend
```

The full trained-model workflow is separate. It needs Python 3.11+, the packages
in `services/ml/requirements.txt` and freshly trained models. Follow the root
README's ML → backend → simulator instructions; the standalone chart does not
prove that their Python installation or full mobile workflow works.

## Walkthrough

1. Select **Moderate exercise**. The starting assumption is a peak reduction
   of 20 mg/dL. This is an illustrative absolute change, not a 20% clinical rule.
2. Select **Add a simulated observation** four times. The generated personal
   observations average a reduction of 30 mg/dL. With four observations and
   a starting weight of four, the estimate becomes a reduction of 25 mg/dL.
3. Show the dashed initial curve, blue adapted curve and dotted comparison
   outcome. The latter is a separate simulated episode and never enters the
   update. Further observations gradually increase the personal influence.
4. Select **Stress**. Its history starts empty. Switch back to exercise to show
   that the earlier observations belong only to exercise. **Reset this example**
   clears the selected event. Reloading clears all histories.
5. Select **Intense exercise** to show a possible increase rather than assuming
   every exercise session lowers glucose. Meal and stress scenarios are also
   available. The displayed range percentages summarise generated readings,
   not clinical accuracy or the quality of insulin control.

## Explain the limits

No insulin is adjusted. The page does not feed the eighteen trained models,
update real patient state or learn from OpenAPS records. Its mean and range
percentages are descriptive summaries, not causal evidence. Real event effects
are mixed with insulin, meals and other influences; this demo knows the baseline
because it generated the example. Hormones, menopause and sleep require further
measurements and are not implemented here.

The existing live simulator → backend → trained-forecast integration is tested
separately in `VALIDATION.md`. Do not claim that chat stress/sleep entries have
been clinically calibrated, that envelope bands have verified coverage, or that
approving a prototype action operates an insulin pump.
