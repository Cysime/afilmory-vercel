/**
 * WebGL图像查看器常量配置
 *
 * 包含所有默认配置值、LOD级别定义等常量
 */

import type {
  DoubleClickConfig,
  PanningConfig,
  PinchConfig,
  WheelConfig,
} from "./interface";

/**
 * 默认滚轮配置
 */
export const defaultWheelConfig: WheelConfig = {
  step: 0.1,
  wheelDisabled: false,
};

/**
 * 默认手势缩放配置
 */
export const defaultPinchConfig: PinchConfig = {
  disabled: false,
};

/**
 * 默认双击配置
 */
export const defaultDoubleClickConfig: DoubleClickConfig = {
  step: 2,
  disabled: false,
  mode: "toggle",
  animationTime: 200,
};

/**
 * 默认平移配置
 */
export const defaultPanningConfig: PanningConfig = {
  disabled: false,
};
