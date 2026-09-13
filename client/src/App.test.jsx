import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App";
import api, { request } from "./services/api";

const state = vi.hoisted(() => ({ superUser: true, listeners: new Set() }));
vi.mock("./services/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  request: vi.fn(),
  onUnauthorized: (listener) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
}));
const schema = [
  {
    name: "id",
    columnKey: "PRI",
    dataType: "int",
    columnType: "int",
    extra: "auto_increment",
  },
  {
    name: "name",
    columnKey: "",
    dataType: "varchar",
    columnType: "varchar(50)",
    extra: "",
  },
];
beforeEach(() => {
  state.superUser = true;
  api.get.mockImplementation(async (url) => ({
    data:
      url === "/auth/me"
        ? {
            username: "tester",
            isSuperUser: state.superUser,
            canRunQueries: true,
          }
        : [{ name: "people" }],
  }));
  request.mockImplementation(async (url) =>
    url.endsWith("/schema")
      ? schema
      : {
          data: [{ id: 1, name: "Alice" }],
          pagination: { page: 1, total: 1, totalPages: 1 },
        },
  );
  api.post.mockResolvedValue({
    data: {
      durationMs: 1,
      results: [
        {
          columns: ["id", "name"],
          rows: [[1, "Alice"]],
          edit: { table: "people", keyColumn: "id", columns: ["id", "name"] },
        },
      ],
    },
  });
  api.put.mockResolvedValue({ data: { success: true } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("active entry supports table search and super-user editing under StrictMode", async () => {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await user.click(await screen.findByRole("button", { name: "people" }));
  await screen.findByText("Alice");
  await user.type(screen.getByPlaceholderText("Search people..."), "Alice");
  await user.click(screen.getByRole("button", { name: "Search", exact: true }));
  await waitFor(() =>
    expect(
      request.mock.calls.some(([url]) => url.includes("search=Alice")),
    ).toBe(true),
  );
  await user.click(
    await screen.findByRole("button", { name: "Edit", exact: true }),
  );
  expect(screen.getByRole("heading", { name: "Edit people" })).toBeTruthy();
});

test("regular users do not see Edit in table or SQL results", async () => {
  state.superUser = false;
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "people" }));
  await screen.findByText("Alice");
  expect(
    screen.queryByRole("button", { name: "Edit", exact: true }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "SQL Console" }));
  await user.click(await screen.findByRole("button", { name: "Run query" }));
  await screen.findByText("1 rows returned");
  expect(
    screen.queryByRole("button", { name: "Edit", exact: true }),
  ).toBeNull();
});

test("SQL editor runs, saves by original primary key, and retains the draft across views", async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "SQL Console" }));
  const editor = await screen.findByLabelText("SQL query");
  await user.clear(editor);
  await user.type(editor, "SELECT * FROM people");
  await user.click(screen.getByRole("button", { name: "Run query" }));
  await user.click(
    await screen.findByRole("button", { name: "Edit", exact: true }),
  );
  await user.clear(screen.getByLabelText("name"));
  await user.type(screen.getByLabelText("name"), "Bob");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith("/tables/people/rows", {
      keyColumn: "id",
      keyValue: 1,
      values: { name: "Bob" },
    }),
  );
  await user.click(screen.getByRole("button", { name: "Table browser" }));
  await user.click(screen.getByRole("button", { name: "SQL Console" }));
  expect(screen.getByLabelText("SQL query").value).toBe("SELECT * FROM people");
});

test("session expiry unmounts the workspace and clears query state", async () => {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole("button", { name: "SQL Console" });
  act(() => state.listeners.forEach((listener) => listener()));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "SQL Console" })).toBeNull();
});
