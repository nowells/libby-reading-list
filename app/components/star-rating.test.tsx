import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { StarRating } from "./star-rating";

describe("StarRating", () => {
  it("renders five star slots", async () => {
    const screen = await render(<StarRating value={undefined} readOnly />);
    const svgs = screen.container.querySelectorAll("svg");
    expect(svgs.length).toBe(5);
  });

  it("renders in readOnly mode without buttons", async () => {
    const screen = await render(<StarRating value={60} readOnly />);
    const buttons = screen.container.querySelectorAll("button");
    expect(buttons.length).toBe(0);
  });

  it("renders interactive buttons when not readOnly", async () => {
    const screen = await render(<StarRating value={40} onChange={vi.fn()} />);
    // 5 slots × 2 half-buttons each + 1 clear button = 11
    const buttons = screen.container.querySelectorAll("button");
    expect(buttons.length).toBe(11);
  });

  it("calls onChange when a star button is clicked", async () => {
    const onChange = vi.fn();
    const screen = await render(<StarRating value={undefined} onChange={onChange} />);
    // Click the first half-star button (10%)
    const firstButton = screen.getByRole("button", { name: "10 percent" });
    await firstButton.click();
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("toggles value off when clicking the same rating", async () => {
    const onChange = vi.fn();
    const screen = await render(<StarRating value={20} onChange={onChange} />);
    const button = screen.getByRole("button", { name: "20 percent" });
    await button.click();
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("shows clear button when value is set and not readOnly", async () => {
    const onChange = vi.fn();
    const screen = await render(<StarRating value={60} onChange={onChange} />);
    const clearButton = screen.getByRole("button", { name: "Clear rating" });
    await clearButton.click();
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("does not show clear button when value is undefined", async () => {
    const screen = await render(<StarRating value={undefined} onChange={vi.fn()} />);
    expect(screen.container.querySelector('[aria-label="Clear rating"]')).toBeNull();
  });
});
