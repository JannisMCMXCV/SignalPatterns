Import ("env")
import os

if not os.path.exists(env.subst("$PROJECT_PACKAGES_DIR/tool-mklittlefs")):
    env.Execute("pio pkg install --tool mklittlefs")

env.Replace(
    MKSPIFFSTOOL=env.subst("$PROJECT_PACKAGES_DIR/tool-mklittlefs/mklittlefs"),
)
