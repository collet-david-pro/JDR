/** Text object (lot l17): plain text drawn by Pixi (never interpreted as markup). */

import { TEXT_FONT_STACKS, type TextObject } from '../../editor/contracts-text';
import { TEXT_OUTLINE_RATIO, textOutlineColor } from '../../editor/text-style';
import type { Container } from '../pixi';
import { Text } from '../pixi';

/** Adds the label of a text object to `parent` (world pixels) and returns it. */
export function addTextLabel(
  parent: Container,
  obj: TextObject,
  cellPx: number,
  bucket: number,
): Text {
  const fontSize = obj.props.size * cellPx;
  const label = new Text({
    text: obj.props.text,
    resolution: Math.min(4, Math.max(1, bucket)),
    style: {
      fontFamily: TEXT_FONT_STACKS[obj.props.font],
      fontSize,
      fill: obj.props.color,
      stroke: { color: textOutlineColor(obj.props.color), width: fontSize * TEXT_OUTLINE_RATIO },
      align: 'center',
    },
  });
  label.anchor.set(0.5);
  label.position.set(obj.geometry.x * cellPx, obj.geometry.y * cellPx);
  label.rotation = (obj.props.rotation * Math.PI) / 180;
  parent.addChild(label);
  return label;
}
