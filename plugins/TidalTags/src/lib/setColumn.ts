import { isElement } from "./isElement";

export const setColumn = (trackRow: Element, name: string, sourceSelector: string, content: HTMLElement, beforeSelector?: string | Element) => {
	let column = trackRow.querySelector<HTMLElement>(`div[data-test="${name}"]`);
	if (column !== null) {
		column.innerHTML = "";
		column.appendChild(content);
		return column;
	}

	const sourceColumn = trackRow.querySelector<HTMLElement>(sourceSelector);
	if (sourceColumn === null) return;

	column = <HTMLElement>sourceColumn?.cloneNode(true);
	if (!isElement(column)) return;

	column.setAttribute("data-test", name);
	column.innerHTML = "";
	column.appendChild(content);
	return sourceColumn.parentElement!.insertBefore(
		column,
		beforeSelector instanceof Element ? beforeSelector : beforeSelector ? trackRow.querySelector(beforeSelector) : sourceColumn
	);
};
