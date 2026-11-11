// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginSettingsSections } from "./PluginSettingsSections";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

function Section() {
  return <p>connect settings</p>;
}

function renderSections(pluginId: string) {
  return render(
    <MemoryRouter>
      <PluginSettingsSections pluginId={pluginId} />
    </MemoryRouter>,
  );
}

describe("PluginSettingsSections", () => {
  it("renders a plugin's settings section through the slot boundary", () => {
    setPluginSlotRegistrations(
      "connect",
      registrationSet({
        settingsSections: [{ id: "remote-access", component: Section }],
      }),
    );
    renderSections("connect");

    expect(screen.getByTestId("plugin-settings-sections")).toBeDefined();
    expect(screen.getByText("connect settings")).toBeDefined();
  });

  it("renders nothing when the plugin registers no section", () => {
    setPluginSlotRegistrations(
      "other",
      registrationSet({
        settingsSections: [{ id: "remote-access", component: Section }],
      }),
    );
    renderSections("connect");

    expect(screen.queryByTestId("plugin-settings-sections")).toBeNull();
  });
});
