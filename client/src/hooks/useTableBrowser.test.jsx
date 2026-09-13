import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { request } from "../services/api";
import useTableBrowser from "./useTableBrowser";

vi.mock("../services/api", () => ({ request: vi.fn() }));
afterEach(cleanup);

test("late responses from an old table selection cannot replace the current results", async () => {
  const pending = [];
  request.mockImplementation(
    (url, options) =>
      new Promise((resolve) => pending.push({ url, options, resolve })),
  );
  const { result, unmount } = renderHook(useTableBrowser);
  let first, second;
  act(() => {
    first = result.current.selectTable("first");
  });
  act(() => {
    second = result.current.selectTable("second");
  });
  expect(pending[0].options.signal.aborted).toBe(true);
  await act(async () => {
    pending[2].resolve([{ name: "id", columnKey: "PRI" }]);
    pending[3].resolve({
      data: [{ id: 2 }],
      pagination: { page: 1, total: 1, totalPages: 1 },
    });
    await second;
  });
  await act(async () => {
    pending[0].resolve([{ name: "wrong" }]);
    pending[1].resolve({ data: [{ wrong: 1 }] });
    await first;
  });
  expect(result.current.table).toBe("second");
  expect(result.current.rows).toEqual([{ id: 2 }]);
  expect(result.current.primaryKey).toBe("id");
  unmount();
  expect(pending[2].options.signal.aborted).toBe(true);
});
