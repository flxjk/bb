// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExperimentBootstrap } from "./flags";

const SERVER_ID = "0199f0a1-2b3c-7d4e-8f90-a1b2c3d4e5f6";

async function loadModules() {
  const [router, client, server, experiments] = await Promise.all([
    import("@tanstack/react-router"),
    import("react-dom/client"),
    import("react-dom/server"),
    import("./use-experiment"),
  ]);
  return { router, client, server, experiments };
}

type Modules = Awaited<ReturnType<typeof loadModules>>;

function createProbeRouter(
  modules: Modules,
  serverExperiments: ExperimentBootstrap | null,
) {
  const { router, experiments } = modules;
  function Probe() {
    const variant = experiments.useExperiment("homepage-qa-check");
    return (
      <main data-qa-check={variant === "test" ? variant : undefined}>
        {variant}
      </main>
    );
  }
  const rootRoute = router.createRootRoute({
    beforeLoad: experiments.experimentsBeforeLoad,
    component: () => (
      <experiments.RouteExperimentsProvider>
        <Probe />
      </experiments.RouteExperimentsProvider>
    ),
  });
  const instance = router.createRouter({
    routeTree: rootRoute,
    history: router.createMemoryHistory({ initialEntries: ["/"] }),
  });
  if (serverExperiments !== null) {
    instance.update({
      additionalContext: { serverContext: { experiments: serverExperiments } },
    });
  }
  return instance;
}

async function serverRender(
  modules: Modules,
  experiments: ExperimentBootstrap,
): Promise<string> {
  const instance = createProbeRouter(modules, experiments);
  await instance.load();
  return modules.server.renderToString(
    <modules.router.RouterProvider router={instance} />,
  );
}

async function hydratePage(
  modules: Modules,
  experiments: ExperimentBootstrap | null,
  html: string,
) {
  const errors: unknown[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const instance = createProbeRouter(modules, experiments);
  await instance.load();
  await act(async () => {
    modules.client.hydrateRoot(
      container,
      <modules.router.RouterProvider router={instance} />,
      { onRecoverableError: (error) => errors.push(error) },
    );
  });
  return { container, errors };
}

function bootstrap(
  featureFlags: Record<string, string>,
  preview = false,
): ExperimentBootstrap {
  return { distinctID: SERVER_ID, featureFlags, preview };
}

describe("server-rendered experiments", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("hydrates the server arm from the bootstrap", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": "test" });
    const html = await serverRender(modules, experiments);
    expect(html).toContain('<main data-qa-check="test">test</main>');
    const { container, errors } = await hydratePage(modules, experiments, html);
    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe(html);
  });

  it("renders control", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": "control" });
    const html = await serverRender(modules, experiments);
    expect(html).toContain("<main>control</main>");
    const { errors } = await hydratePage(modules, experiments, html);
    expect(errors).toEqual([]);
  });

  it("renders an unknown variant as control", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": "holdout-7" });
    const html = await serverRender(modules, experiments);
    expect(html).toContain("<main>control</main>");
  });

  it("renders control without an active flag", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({});
    const html = await serverRender(modules, experiments);
    expect(html).toContain("<main>control</main>");
  });

  it("renders the forced variant for a preview", async () => {
    const modules = await loadModules();
    const experiments = bootstrap({ "homepage-qa-check": "test" }, true);
    const html = await serverRender(modules, experiments);
    expect(html).toContain('data-qa-check="test"');
    const { errors } = await hydratePage(modules, experiments, html);
    expect(errors).toEqual([]);
  });

  it("renders control without a server bootstrap", async () => {
    const modules = await loadModules();
    const html = await serverRender(modules, bootstrap({}));
    const { container } = await hydratePage(modules, null, html);
    expect(container.textContent).toBe("control");
  });
});
