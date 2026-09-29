const isProduction = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? "none" : "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const setAuthCookie = (res, token) =>
  res.cookie("token", token, cookieOptions);

export const clearAuthCookie = (res) => {
  const { maxAge, ...clearOptions } = cookieOptions;
  res.clearCookie("token", clearOptions);
};
