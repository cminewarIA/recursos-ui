# 📦 Paquetes y Herramientas de Compilación Offline (`packages/`)

Esta carpeta contiene los paquetes y scripts esenciales para acelerar la compilación de aplicaciones nativas (**Linux `.deb`** y **Android `.apk`**), tanto en el servidor local como en las ejecuciones continuas de **GitHub Actions**.

---

## 🗂️ Estructura del Directorio

```text
packages/
├── debian/                     # Paquetes .deb descargados para compilación Linux offline
│   ├── binutils_*.deb
│   ├── binutils-common_*.deb
│   ├── binutils-x86-64-linux-gnu_*.deb
│   ├── dpkg-dev_*.deb
│   ├── fakeroot_*.deb
│   ├── libbinutils_*.deb
│   ├── libdpkg-perl_*.deb
│   ├── make_*.deb
│   └── patch_*.deb
├── scripts/
│   ├── install_packages.sh     # Instalación offline-first ultrarrápida (<1s)
│   └── verify_packages.sh      # Verificación del estado de salud de compiladores
└── README.md                   # Esta documentación técnica
```

---

## 🚀 Ventajas y Aceleración

1. **Instalación Offline Instantánea**:
   - Evita la necesidad de ejecutar `sudo apt-get update` en cada pipeline de CI/CD o compilación local (ahorro de 15 a 20 segundos por ejecución).
   - Los paquetes `.deb` locales se instalan directamente con `dpkg -i` en menos de 1 segundo.
2. **Cero Dependencia de Red para Empaquetado Linux**:
   - Permite compilar paquetes `.deb` en servidores o contenedores sin acceso a repositorios externos o cuando los mirrors de Ubuntu se encuentren degradados.
3. **Optimización de Compilación Android**:
   - Combinado con `gradle/actions/setup-gradle@v4` y las directivas de caché en `gradle.properties`, reduce la compilación de Gradle de varios minutos a escasos segundos al reutilizar dependencias y artefactos previamente resueltos.
