package de.artur.justpdf.ui

import android.util.Base64
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import de.artur.justpdf.ui.home.HomeScreen
import de.artur.justpdf.ui.settings.SettingsScreen
import de.artur.justpdf.ui.viewer.ViewerScreen

object Routes {
    const val HOME = "home"
    const val SETTINGS = "settings"
    const val VIEWER = "viewer/{uri}/{name}"
    fun viewer(rawUri: String, rawName: String): String =
        "viewer/${enc(rawUri)}/${enc(rawName)}"
}

/** URL-safe base64 so a content:// URI survives being a nav path segment untouched. */
fun enc(value: String): String =
    Base64.encodeToString(value.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

fun dec(value: String): String =
    runCatching { String(Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8) }
        .getOrDefault(value)

@Composable
fun JustPdfRoot(initialPdfUri: String?, onInitialConsumed: () -> Unit) {
    val navController = rememberNavController()

    LaunchedEffect(initialPdfUri) {
        if (!initialPdfUri.isNullOrBlank()) {
            navController.navigate(Routes.viewer(initialPdfUri, ""))
            onInitialConsumed()
        }
    }

    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                onOpenPdf = { uri, name -> navController.navigate(Routes.viewer(uri, name)) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
        composable(
            route = Routes.VIEWER,
            arguments = listOf(
                navArgument("uri") { type = NavType.StringType },
                navArgument("name") { type = NavType.StringType },
            ),
        ) { entry ->
            val rawUri = dec(entry.arguments?.getString("uri").orEmpty())
            ViewerScreen(
                rawUri = rawUri,
                onBack = {
                    if (!navController.popBackStack()) navController.navigate(Routes.HOME)
                },
            )
        }
    }
}
